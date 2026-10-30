"""Voice Generator tests: voice list, MP3 generation + download, history, errors, delivery tags
and the ElevenLabs route (the online voice services are stubbed so the tests run offline)."""
import edge_tts
import pytest
from fastapi.testclient import TestClient

from app.config import WORK_DIR, ensure_dirs
from app.ffmpeg_util import probe, run_ffmpeg
from app.main import app
from app.tools.voiceover import api as vo
from app.tools.voiceover import elevenlabs
from app.tools.voiceover.tags import Say, chunks, parse, strip

VOICES = [
    {"ShortName": "en-US-AriaNeural", "Gender": "Female", "Locale": "en-US",
     "LocaleName": "English (United States)", "VoiceTag": {"VoicePersonalities": ["Positive"]}},
    {"ShortName": "hi-IN-MadhurNeural", "Gender": "Male", "Locale": "hi-IN",
     "LocaleName": "Hindi (India)", "VoiceTag": {}},
    {"ShortName": "en-US-AndrewMultilingualNeural", "Gender": "Male", "Locale": "en-US",
     "LocaleName": "English (United States)", "VoiceTag": {}},
]
calls = []


def _mp3(seconds: float, rate: int = 24000) -> bytes:
    ensure_dirs()
    out = WORK_DIR / f"tone_{seconds}_{rate}.mp3"
    if not out.exists():
        run_ffmpeg(["-f", "lavfi", "-i", f"sine=frequency=300:duration={seconds}:sample_rate={rate}",
                    "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", str(out)])
    return out.read_bytes()


class FakeSpeech:
    def __init__(self, text, voice, rate, pitch, volume="+0%"):
        calls.append((text, voice, rate, pitch) if volume == "+0%" else (text, voice, rate, pitch, volume))
        self.text = text

    async def stream(self):
        if self.text == "fail":
            raise edge_tts.exceptions.NoAudioReceived()
        yield {"type": "WordBoundary"}
        yield {"type": "audio", "data": _mp3(0.5)}


@pytest.fixture
def client(monkeypatch):
    async def list_voices():
        return VOICES
    monkeypatch.setattr(vo, "_voices", [])
    monkeypatch.setattr(vo, "_eleven", [])
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.setattr(vo.edge_tts, "list_voices", list_voices)
    monkeypatch.setattr(vo.edge_tts, "Communicate", FakeSpeech)
    calls.clear()
    return TestClient(app)


def test_voices_are_grouped_by_language_with_readable_names(client):
    res = client.get("/api/voiceover/voices").json()
    assert res["elevenlabs"] is False
    v = res["voices"]
    assert [x["name"] for x in v] == ["Andrew (Multilingual)", "Aria", "Madhur"]
    assert v[1] == {"id": "en-US-AriaNeural", "name": "Aria", "gender": "Female", "locale": "en-US",
                    "language": "English (United States)", "styles": ["Positive"]}


def test_speak_saves_an_mp3_to_play_and_download(client):
    r = client.post("/api/voiceover/speak", json={
        "text": " नमस्ते, आज हम एक नई कहानी देखेंगे। ", "voice": "hi-IN-MadhurNeural",
        "rate": 15, "pitch": -5}).json()
    assert calls == [("नमस्ते, आज हम एक नई कहानी देखेंगे।", "hi-IN-MadhurNeural", "+15%", "-5Hz")]
    assert abs(r["duration"] - 0.5) < 0.1 and r["text"].startswith("नमस्ते")
    assert client.get(r["url"]).content == _mp3(0.5)
    d = client.get(r["download"])
    assert d.headers["content-type"] == "audio/mpeg"
    assert "attachment" in d.headers["content-disposition"]
    assert "%E0%A4%A8%E0%A4%AE%E0%A4%B8%E0%A5%8D%E0%A4%A4%E0%A5%87_" in d.headers["content-disposition"]

    assert [i["id"] for i in client.get("/api/voiceover/items").json()][0] == r["id"]
    client.delete(f"/api/voiceover/items/{r['id']}")
    assert r["id"] not in [i["id"] for i in client.get("/api/voiceover/items").json()]
    assert client.get(r["download"]).status_code == 404


def test_preview_returns_audio_without_saving(client):
    before = len(client.get("/api/voiceover/items").json())
    r = client.post("/api/voiceover/preview", json={"text": "", "voice": "en-US-AriaNeural"})
    assert r.headers["content-type"] == "audio/mpeg" and r.content
    assert calls[0][0] == "Hello! This is how my voice sounds."
    assert len(client.get("/api/voiceover/items").json()) == before


def test_bad_requests_get_clear_messages(client):
    def err(body):
        r = client.post("/api/voiceover/speak", json={"voice": "en-US-AriaNeural", **body})
        return r.status_code, r.json()["detail"]
    assert err({"text": "  "})[0] == 400
    assert "voice" in err({"text": "hi", "voice": "xx-XX-Nobody"})[1]
    assert "too long" in err({"text": "a" * 20_001})[1]
    assert "try another voice" in err({"text": "fail"})[1]
    assert client.post("/api/voiceover/speak", json={"text": "hi", "voice": "en-US-AriaNeural",
                                                     "rate": 500}).status_code == 422
    assert client.get("/api/voiceover/items/../../x/download").status_code == 404


def test_tags_become_pauses_and_moods_never_words():
    parts = parse("[softly] Some voices… you should never answer.\n\n"
                  "[nervous] \"Open the door.\" [pause] It was his voice.\n"
                  "[long pause] [slowly] [whispers] He was asleep. [laughs] Really.", rate=10)
    assert parts == [
        Say("Some voices… you should never answer.", 2, -4, -25), 0.2,
        Say('"Open the door."', 16, 6, -10), 0.7, Say("It was his voice.", 16, 6, -10),
        0.2 + 1.6,  # line gap + long pause, merged
        Say("He was asleep.", -24, -8, -40),  # slowly + whispers add up
        Say("Really.", 10, 0, 0),  # unknown tag: dropped, mood back to normal
    ]
    assert not any("[" in p.text for p in parts if isinstance(p, Say))
    assert parse("[pause] Hi [pause]") == [Say("Hi")]
    assert strip("[whispers] Open [pau") == "Open"


def test_long_scripts_are_split_at_line_or_sentence_ends():
    text = "One. " * 30 + "\nTwo.\nThree."
    out = chunks(text, 60)
    assert all(len(c) <= 60 for c in out)
    assert " ".join(" ".join(out).split()) == " ".join(text.split())
    assert out[-1].endswith("Two.\nThree.")


def test_a_tagged_script_is_joined_into_one_mp3_with_its_pauses(client):
    r = client.post("/api/voiceover/speak", json={
        "text": "[softly] First tagged line. [long pause] Second.\n[urgent] Third.",
        "voice": "en-US-AriaNeural"}).json()
    assert [c[0] for c in calls] == ["First tagged line.", "Second.", "Third."]
    assert calls[0][2:] == ("-8%", "-4Hz", "-25%") and calls[2][2:] == ("+22%", "+4Hz", "+10%")
    path = vo.VOICEOVER_DIR / f"{r['id']}.mp3"
    # 3 × 0.5 s of speech + 1.6 s pause + 0.2 s line gap
    assert abs(probe(path).duration - 3.3) < 0.15
    assert abs(r["duration"] - 3.3) < 0.15
    assert "First_tagged_line_Second" in client.get(r["download"]).headers["content-disposition"]


def test_elevenlabs_voices_get_the_script_with_its_tags(client, monkeypatch):
    sent = []

    async def voices():
        return [{"id": "eleven:abc", "name": "Rachel", "gender": "Female", "locale": "elevenlabs",
                 "language": elevenlabs.LANGUAGE, "styles": [], "sample": "https://x/rachel.mp3"}]

    async def speak(text, voice):
        sent.append((text, voice))
        return [_mp3(1, 44100), _mp3(1, 44100)]
    monkeypatch.setenv("ELEVENLABS_API_KEY", "k")
    monkeypatch.setattr(elevenlabs, "voices", voices)
    monkeypatch.setattr(elevenlabs, "speak", speak)
    res = client.get("/api/voiceover/voices").json()
    assert res["elevenlabs"] is True and res["voices"][0]["id"] == "eleven:abc"
    text = "[whispers] Open the door. [long pause] Please."
    r = client.post("/api/voiceover/speak", json={"text": text, "voice": "eleven:abc"}).json()
    assert sent == [(text, "eleven:abc")] and not calls
    assert abs(probe(vo.VOICEOVER_DIR / f"{r['id']}.mp3").duration - 2) < 0.15
