"""Voice Generator tests: voice list, MP3 generation + download, history, errors, delivery tags
and the ElevenLabs route (the online voice services are stubbed so the tests run offline)."""
import array
import json
import math

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


def _recording(seconds: float) -> bytes:
    """What a browser sends: WebM with Opus-style audio, not an MP3."""
    ensure_dirs()
    out = WORK_DIR / f"rec_{seconds}.webm"
    if not out.exists():
        run_ffmpeg(["-f", "lavfi", "-i", f"sine=frequency=300:duration={seconds}", "-c:a", "libopus", str(out)])
    return out.read_bytes()


def test_recording_is_kept_as_an_mp3_in_the_history(client):
    r = client.post("/api/voiceover/record", files={"file": ("voice.webm", _recording(2), "audio/webm")})
    assert r.status_code == 200, r.text
    item = r.json()
    assert item["voice"] == "recording" and item["text"].startswith("Recording")
    assert item["duration"] == pytest.approx(2, abs=.15)
    assert client.get(item["url"]).content[:3] in (b"ID3", b"\xff\xfb")
    assert item["id"] in [x["id"] for x in client.get("/api/voiceover/items").json()]
    assert client.post("/api/voiceover/record", files={"file": ("x", b"not audio", "audio/webm")}).status_code == 400
    assert client.post("/api/voiceover/record",
                       files={"file": ("x", _recording(.1), "audio/webm")}).status_code == 400


def test_edit_trims_and_changes_speed_and_keeps_the_original(client):
    item = client.post("/api/voiceover/record", files={"file": ("v.webm", _recording(4), "audio/webm")}).json()
    url = f"/api/voiceover/items/{item['id']}/edit"
    edited = client.post(url, json={"start": 1, "end": 3, "speed": 2}).json()
    assert edited["duration"] == pytest.approx(1, abs=.15)
    assert edited["id"] != item["id"] and edited["text"] == item["text"] + " (edited)"
    assert client.get(item["url"]).status_code == 200
    # Slower makes it longer, and the end is capped at the real length.
    slower = client.post(url, json={"start": 3, "end": 99, "speed": .5}).json()
    assert slower["duration"] == pytest.approx(2, abs=.2)
    again = client.post(f"/api/voiceover/items/{edited['id']}/edit", json={"start": 0, "end": .9}).json()
    assert again["text"] == edited["text"] and again["duration"] == pytest.approx(.9, abs=.15)
    assert client.post(url, json={"start": 2, "end": 2.1}).status_code == 400
    assert client.post(url, json={"start": 3, "end": 2}).status_code == 400
    assert client.post(url, json={"start": 0, "end": 2, "speed": 9}).status_code == 422
    assert client.post("/api/voiceover/items/abc/edit", json={"start": 0, "end": 2}).status_code == 404


def test_rename_shows_in_the_list_and_the_download_and_leaves_the_script(client):
    item = client.post("/api/voiceover/record", files={"file": ("v.webm", _recording(2), "audio/webm")}).json()
    assert item["name"] == ""
    url = f"/api/voiceover/items/{item['id']}"
    named = client.patch(url, json={"name": "  Riya intro/take 2  "}).json()
    assert named["name"] == "Riya intro/take 2" and named["text"] == item["text"]
    assert client.get("/api/voiceover/items").json()[0]["name"] == "Riya intro/take 2"
    assert "Riya_introtake_2.mp3" in client.get(named["download"]).headers["content-disposition"]
    edited = client.post(f"{url}/edit", json={"start": 0, "end": 1}).json()
    assert edited["name"] == "Riya intro/take 2 (edited)"
    again = client.post(f"/api/voiceover/items/{edited['id']}/edit", json={"start": 0, "end": .8}).json()
    assert again["name"] == edited["name"]
    assert client.patch(url, json={"name": ""}).json()["name"] == ""  # back to showing the script
    assert client.patch(url, json={"name": "x" * 81}).status_code == 422
    assert client.patch("/api/voiceover/items/abc", json={"name": "x"}).status_code == 404


def test_voiceovers_saved_before_names_existed_still_work(client):
    item = client.post("/api/voiceover/record", files={"file": ("v.webm", _recording(2), "audio/webm")}).json()
    path = vo._meta_path(item["id"])
    meta = json.loads(path.read_text())
    del meta["name"]
    path.write_text(json.dumps(meta))
    assert client.get("/api/voiceover/items").json()[0]["name"] == ""
    assert client.get(item["download"]).status_code == 200


def _level(mp3: bytes, start: float, end: float) -> float:
    """How loud a stretch of an MP3 is (root mean square of its samples)."""
    path = WORK_DIR / "level.mp3"
    pcm = WORK_DIR / "level.raw"
    path.write_bytes(mp3)
    run_ffmpeg(["-i", str(path), "-ss", str(start), "-to", str(end), "-f", "s16le", "-ac", "1", "-ar", "8000",
                str(pcm)])
    samples = array.array("h", pcm.read_bytes())
    return math.sqrt(sum(v * v for v in samples) / len(samples))


def _noisy_take(volume: float) -> bytes:
    """Three seconds of a voice-like tone with a second of steady hiss after it."""
    ensure_dirs()
    out = WORK_DIR / f"noisy_{volume}.webm"
    graph = (f"sine=f=300:d=3,apad=whole_dur=4,volume={volume}[voice];"
             "anoisesrc=d=4:a=0.02:c=white[hiss];[voice][hiss]amix=inputs=2:normalize=0")
    run_ffmpeg(["-f", "lavfi", "-i", graph, "-c:a", "libopus", str(out)])
    return out.read_bytes()


def test_clean_up_previews_without_saving_and_quietens_the_noise(client):
    item = client.post("/api/voiceover/record", files={"file": ("v.webm", _noisy_take(.3), "audio/webm")}).json()
    url = f"/api/voiceover/items/{item['id']}/preview"
    original = client.get(item["url"]).content
    count = len(client.get("/api/voiceover/items").json())
    cleaned = client.post(url, json={"noise": True}).content
    assert len(client.get("/api/voiceover/items").json()) == count
    assert _level(cleaned, 3.3, 3.9) < _level(original, 3.3, 3.9) / 2  # hiss down
    assert _level(cleaned, 1, 2) > _level(original, 1, 2) * .7  # voice kept
    assert client.post(url, json={}).status_code == 400
    assert client.post("/api/voiceover/items/abc/preview", json={"noise": True}).status_code == 404


def test_clean_up_evens_the_volume_and_the_edit_keeps_it(client):
    item = client.post("/api/voiceover/record", files={"file": ("v.webm", _noisy_take(.03), "audio/webm")}).json()
    original = client.get(item["url"]).content
    louder = client.post(f"/api/voiceover/items/{item['id']}/preview", json={"volume": True}).content
    assert _level(louder, 1, 2) > _level(original, 1, 2) * 2
    edit = {"start": 0, "end": 2, "volume": True}
    saved = client.post(f"/api/voiceover/items/{item['id']}/edit", json=edit).json()
    assert saved["duration"] == pytest.approx(2, abs=.15)
    assert _level(client.get(saved["url"]).content, .5, 1.5) > _level(original, 1, 2) * 2


def _hertz(mp3: bytes, start: float, end: float) -> float:
    """The pitch of a plain tone, from how often it crosses zero."""
    path = WORK_DIR / "hertz.mp3"
    pcm = WORK_DIR / "hertz.raw"
    path.write_bytes(mp3)
    run_ffmpeg(["-i", str(path), "-ss", str(start), "-to", str(end), "-f", "s16le", "-ac", "1", "-ar", "44100",
                str(pcm)])
    v = array.array("h", pcm.read_bytes())
    crossings = sum(1 for a, b in zip(v, v[1:]) if a < 0 <= b)
    return crossings / (len(v) / 44100)


@pytest.mark.parametrize("semitones", [12, -12, 4, -5])
def test_pitch_moves_the_note_and_keeps_the_length(client, semitones):
    item = client.post("/api/voiceover/record", files={"file": ("v.webm", _recording(4), "audio/webm")}).json()
    shifted = client.post(f"/api/voiceover/items/{item['id']}/preview", json={"pitch": semitones}).content
    assert _hertz(shifted, 1, 3) == pytest.approx(300 * 2 ** (semitones / 12), rel=.03)
    path = WORK_DIR / "shifted.mp3"
    path.write_bytes(shifted)
    assert probe(path).duration == pytest.approx(item["duration"], abs=.2)


def test_every_voice_style_works_and_saves_with_trim_and_speed(client):
    item = client.post("/api/voiceover/record", files={"file": ("v.webm", _recording(2), "audio/webm")}).json()
    base = f"/api/voiceover/items/{item['id']}"
    for style in vo.STYLES:
        if style:
            r = client.post(f"{base}/preview", json={"style": style})
            assert r.status_code == 200, style
    assert client.post(f"{base}/preview", json={"style": "kazoo"}).status_code == 400
    assert client.post(f"{base}/preview", json={"pitch": 30}).status_code == 422
    assert client.post(f"{base}/preview", json={}).status_code == 400
    saved = client.post(f"{base}/edit", json={"start": .5, "end": 1.5, "speed": 2, "pitch": 12,
                                              "style": "radio"}).json()
    assert saved["duration"] == pytest.approx(.5, abs=.15)
    assert _hertz(client.get(saved["url"]).content, .1, .4) == pytest.approx(600, rel=.05)
    generated = client.post("/api/voiceover/speak", json={"text": "Hello there", "voice": "en-US-AriaNeural"}).json()
    r = client.post(f"/api/voiceover/items/{generated['id']}/preview", json={"pitch": -3, "style": "deep"})
    assert r.status_code == 200  # generated voices use a different sample rate
