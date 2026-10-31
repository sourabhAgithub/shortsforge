"""HTTP routes for the AI Voiceover tool, mounted at /api/voiceover.

Free voices come from edge-tts (Microsoft's neural voices behind Edge's "Read aloud"): no API key,
hundreds of voices in many languages. With ELEVENLABS_API_KEY set, ElevenLabs voices are added too.
Both need an internet connection. Scripts can carry delivery tags such as [whispers] or [pause]
(see tags.py). You can also record your own voice in the browser, and trim or speed up any saved
voiceover; both work offline, and an edit saves a new MP3 next to the original."""
import array
import asyncio
import json
import math
import re
import shutil
import time
import uuid
from pathlib import Path

import aiohttp
import edge_tts
from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from ...config import VOICEOVER_DIR, WORK_DIR
from ...ffmpeg_util import FFmpegError, probe, run_ffmpeg
from . import elevenlabs
from .tags import Say, parse, strip

router = APIRouter()
MAX_CHARS = 20_000
KEEP = 50  # newest voiceovers kept on disk; older ones are deleted
BITRATE = 48_000  # edge-tts sends 24 kHz 48 kbit/s mono MP3 (constant bitrate)
SAMPLE_RATE = 24_000
MAX_RECORDING = 200 * 1024 * 1024
MIN_SECONDS = 0.3  # shorter than this isn't a recording, or an edit worth keeping
RECORDING = "recording"  # the `voice` of a recorded item
NOISE_ABOVE_FLOOR = 14  # dB; the filter's noise level for a measured floor (found by testing)
NOISE_MAX = -25  # dB; past this, a recording with few pauses would lose some of the voice
VOLUME = "loudnorm=I=-16:TP=-1.5:LRA=11"  # the usual loudness for spoken audio online
RATE = 44_100  # everything saved from the editor uses this sample rate
# Voice styles; the editor's list (with each style's starting pitch) is in VoiceEditor.tsx.
STYLES = {
    "": "",
    "deep": "bass=g=5",
    "warm": "bass=g=3,treble=g=-3",
    "bright": "treble=g=5",
    "child": "treble=g=3",
    "chipmunk": "treble=g=2",
    "monster": "bass=g=6,tremolo=f=30:d=0.25",
    "radio": "highpass=f=300,lowpass=f=3400,acompressor=threshold=0.1:ratio=4:makeup=2",
    "phone": "highpass=f=500,lowpass=f=2600",
    "robot": "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75",
    "echo": "aecho=0.8:0.7:300:0.4",
    "hall": "aecho=0.8:0.85:60|90|130:0.35|0.25|0.2",
    "horror": "aecho=0.8:0.7:90|180:0.35|0.25,bass=g=4,tremolo=f=6:d=0.2",
}
_voices: list[dict] = []
_eleven: list[dict] = []


class SpeakRequest(BaseModel):
    text: str
    voice: str
    rate: int = Field(0, ge=-50, le=100)  # percent faster (+) or slower (-); free voices only
    pitch: int = Field(0, ge=-50, le=50)  # Hz higher (+) or lower (-); free voices only


class RenameRequest(BaseModel):
    name: str = Field(max_length=80)  # empty = go back to showing the script


class Effects(BaseModel):
    noise: bool = False
    volume: bool = False
    pitch: float = Field(0, ge=-12, le=12)  # semitones; the length stays the same
    style: str = ""


class EditRequest(Effects):
    start: float = Field(ge=0)  # the part to keep, in seconds of the original
    end: float = Field(gt=0)
    speed: float = Field(1.0, ge=0.5, le=3)  # 2 = twice as fast; the pitch stays the same


def _display_name(short_name: str) -> str:
    """"en-US-AndrewMultilingualNeural" -> "Andrew (Multilingual)"."""
    name = short_name.split("-", 2)[-1].removesuffix("Neural")
    if name.endswith("Multilingual"):
        return f"{name.removesuffix('Multilingual')} (Multilingual)"
    return name


async def _edge(say: Say, voice: str) -> bytes:
    speech = edge_tts.Communicate(say.text, voice, rate=f"{say.rate:+d}%", pitch=f"{say.pitch:+d}Hz",
                                  volume=f"{say.volume:+d}%")
    audio = bytearray()
    try:
        async with asyncio.timeout(180):
            async for chunk in speech.stream():
                if chunk["type"] == "audio":
                    audio += chunk["data"]
    except edge_tts.exceptions.NoAudioReceived:
        raise HTTPException(400, "This voice couldn't read the script. Check it's in the voice's "
                                 "language, or try another voice.") from None
    except (TimeoutError, OSError, aiohttp.ClientError, edge_tts.exceptions.EdgeTTSException):
        raise HTTPException(502, "Couldn't reach the voice service. Check your internet "
                                 "connection and try again.") from None
    return bytes(audio)


def _join(pieces: list[bytes | float], sample_rate: int, bitrate: int) -> bytes:
    """One MP3 from audio pieces and pauses (floats, in seconds)."""
    tmp = WORK_DIR / f"voice_{uuid.uuid4().hex[:8]}"
    tmp.mkdir(parents=True)
    try:
        args, labels = [], []
        for i, p in enumerate(pieces):
            if isinstance(p, float):
                args += ["-f", "lavfi", "-t", f"{p:.2f}", "-i", f"anullsrc=r={sample_rate}:cl=mono"]
            else:
                (tmp / f"{i}.mp3").write_bytes(p)
                args += ["-i", str(tmp / f"{i}.mp3")]
            labels.append(f"[{i}:a]aformat=sample_rates={sample_rate}:channel_layouts=mono[a{i}]")
        graph = ";".join(labels) + ";" + "".join(f"[a{i}]" for i in range(len(pieces))) + \
            f"concat=n={len(pieces)}:v=0:a=1[out]"
        out = tmp / "out.mp3"
        run_ffmpeg([*args, "-filter_complex", graph, "-map", "[out]", "-c:a", "libmp3lame",
                    "-b:a", str(bitrate), str(out)])
        return out.read_bytes()
    except FFmpegError:
        raise HTTPException(500, "Couldn't put the voiceover together. Please try again.") from None
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def _synthesize(req: SpeakRequest) -> tuple[bytes, int]:
    """The script as one MP3, and its bitrate (to work out the length)."""
    text = req.text.strip()
    if not strip(text):
        raise HTTPException(400, "Type the script you want spoken first.")
    if len(text) > MAX_CHARS:
        raise HTTPException(400, f"The script is too long. Keep it under {MAX_CHARS:,} characters.")
    if req.voice not in {v["id"] for v in await _load_voices()}:
        raise HTTPException(400, "Pick a voice from the list.")

    if req.voice.startswith(elevenlabs.PREFIX):
        pieces: list[bytes | float] = list(await elevenlabs.speak(text, req.voice))
        sample_rate, bitrate = elevenlabs.SAMPLE_RATE, elevenlabs.BITRATE
    else:
        parts = parse(text, req.rate, req.pitch)
        limit = asyncio.Semaphore(4)

        async def one(p):
            if isinstance(p, float):
                return p
            async with limit:
                return await _edge(p, req.voice)
        pieces = list(await asyncio.gather(*map(one, parts)))
        sample_rate, bitrate = SAMPLE_RATE, BITRATE
    if len(pieces) == 1:
        return pieces[0], bitrate
    return await asyncio.to_thread(_join, pieces, sample_rate, bitrate), bitrate


async def _load_voices() -> list[dict]:
    if not _voices:
        try:
            raw = await edge_tts.list_voices()
        except Exception:
            raise HTTPException(502, "Couldn't load the voice list. Check your internet connection "
                                     "and try again.") from None
        _voices.extend(sorted((
            {"id": v["ShortName"], "name": _display_name(v["ShortName"]), "gender": v["Gender"],
             "locale": v["Locale"], "language": v["LocaleName"],
             "styles": v.get("VoiceTag", {}).get("VoicePersonalities", [])}
            for v in raw), key=lambda v: (v["language"], v["name"])))
    if not _eleven:
        _eleven.extend(await elevenlabs.voices())
    return _eleven + _voices


def _meta_path(item_id: str):
    if not re.fullmatch(r"[a-f0-9]{12}", item_id):
        raise HTTPException(404, "Voiceover not found")
    return VOICEOVER_DIR / f"{item_id}.json"


def _item(meta: dict) -> dict:
    return {"name": "", **meta, "url": f"/media/voiceover/{meta['id']}.mp3",
            "download": f"/api/voiceover/items/{meta['id']}/download"}


def _all_meta() -> list[dict]:
    out = []
    for f in VOICEOVER_DIR.glob("*.json"):
        try:
            out.append(json.loads(f.read_text()))
        except (OSError, ValueError):
            continue
    return sorted(out, key=lambda m: m["created_at"], reverse=True)


def _noise_floor(mp3: Path) -> float:
    """How loud a recording's quietest moments are, in dB: the background, between the words."""
    tmp = WORK_DIR / f"floor_{uuid.uuid4().hex[:8]}.raw"
    try:
        run_ffmpeg(["-i", str(mp3), "-f", "s16le", "-ac", "1", "-ar", "8000", str(tmp)])
        samples = array.array("h", tmp.read_bytes())
    finally:
        tmp.unlink(missing_ok=True)
    window = 400  # 50 ms
    levels = sorted(math.sqrt(sum(v * v for v in samples[i:i + window]) / window)
                    for i in range(0, len(samples) - window, window))
    quiet = levels[len(levels) // 10] if levels else 1
    return 20 * math.log10(max(quiet, 1) / 32768)


def _effects(req: Effects, mp3: Path) -> list[str]:
    if req.style not in STYLES:
        raise HTTPException(400, "Pick a voice style from the list.")
    chain = []
    if req.noise:  # cut the low rumble, then steady hiss and hum at this recording's own level
        floor = min(max(_noise_floor(mp3) + NOISE_ABOVE_FLOOR, -80), NOISE_MAX)
        chain += ["highpass=f=80", f"afftdn=nr=24:nf={floor:.1f}"]
    if req.pitch:  # play it faster or slower for the pitch, then restore the length
        ratio = 2 ** (req.pitch / 12)
        chain += [f"aresample={RATE}", f"asetrate={RATE * ratio:.0f}", f"aresample={RATE}", f"atempo={1 / ratio:.5f}"]
    if req.style:
        chain += [STYLES[req.style], "alimiter=limit=0.95"]
    return chain + ([VOLUME] if req.volume else [])


def _store(audio: bytes, duration: float, text: str, voice: str, rate: int = 0, pitch: int = 0,
           name: str = "") -> dict:
    """Save an MP3 to the history, and drop the oldest past KEEP."""
    item_id = uuid.uuid4().hex[:12]
    (VOICEOVER_DIR / f"{item_id}.mp3").write_bytes(audio)
    meta = {"id": item_id, "name": name, "text": text, "voice": voice, "rate": rate, "pitch": pitch,
            "duration": round(duration, 2), "created_at": time.time()}
    _meta_path(item_id).write_text(json.dumps(meta))
    for old in _all_meta()[KEEP:]:
        _delete(old["id"])
    return _item(meta)


def _to_mp3(source: bytes | Path, *args: str) -> tuple[bytes, float]:
    """Run audio through FFmpeg into an MP3; returns it and its length."""
    tmp = WORK_DIR / f"voice_{uuid.uuid4().hex[:8]}"
    tmp.mkdir(parents=True)
    try:
        if isinstance(source, bytes):
            (tmp / "in").write_bytes(source)
            source = tmp / "in"
        out = tmp / "out.mp3"
        run_ffmpeg(["-i", str(source), "-vn", *args, "-c:a", "libmp3lame", "-b:a", "128k", str(out)])
        return out.read_bytes(), probe(out).duration
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@router.get("/voices")
async def voices() -> dict:
    return {"voices": await _load_voices(), "elevenlabs": bool(elevenlabs.key())}


@router.post("/preview")
async def preview(req: SpeakRequest) -> Response:
    """A short sample for the voice picker; nothing is saved."""
    req.text = strip(req.text)[:200] or "Hello! This is how my voice sounds."
    return Response((await _synthesize(req))[0], media_type="audio/mpeg")


@router.post("/speak")
async def speak(req: SpeakRequest) -> dict:
    audio, bitrate = await _synthesize(req)
    return _store(audio, len(audio) * 8 / bitrate, req.text.strip(), req.voice, req.rate, req.pitch)


@router.post("/record")
def record(file: UploadFile) -> dict:
    """Keep a recording made in the browser (WebM or MP4, depending on the browser) as an MP3."""
    data = file.file.read(MAX_RECORDING + 1)
    if len(data) > MAX_RECORDING:
        raise HTTPException(400, "That recording is too long. Keep it under 30 minutes.")
    try:
        audio, duration = _to_mp3(data, "-ac", "1", "-ar", "44100")
    except FFmpegError:
        raise HTTPException(400, "That recording couldn't be read. Please try again.") from None
    if duration < MIN_SECONDS:
        raise HTTPException(400, "That recording is too short. Please try again.")
    return _store(audio, duration, time.strftime("Recording %d %b %H:%M"), RECORDING)


@router.post("/items/{item_id}/preview")
def preview_effects(item_id: str, req: Effects) -> Response:
    """Hear a clean-up, pitch or style before keeping it; nothing is saved."""
    path = _meta_path(item_id)
    if not path.exists():
        raise HTTPException(404, "Voiceover not found")
    mp3 = path.with_suffix(".mp3")
    chain = _effects(req, mp3)
    if not chain:
        raise HTTPException(400, "Pick what to change first.")
    try:
        audio, _ = _to_mp3(mp3, "-af", ",".join(chain), "-ar", str(RATE))
    except FFmpegError:
        raise HTTPException(500, "Couldn't change the audio. Please try again.") from None
    return Response(audio, media_type="audio/mpeg")


@router.post("/items/{item_id}/edit")
def edit(item_id: str, req: EditRequest) -> dict:
    """Keep part of a voiceover at a new speed, as a new MP3."""
    path = _meta_path(item_id)
    if not path.exists():
        raise HTTPException(404, "Voiceover not found")
    meta = json.loads(path.read_text())
    mp3 = path.with_suffix(".mp3")
    end = min(req.end, probe(mp3).duration)
    if end - req.start < MIN_SECONDS:
        raise HTTPException(400, "Keep at least a moment of the voiceover.")
    # Effects first, as in the preview, so the save sounds like what was heard.
    chain = [*_effects(req, mp3), f"atrim={req.start:.3f}:{end:.3f}", "asetpts=PTS-STARTPTS",
             f"atempo={req.speed:.4f}"]
    try:
        audio, duration = _to_mp3(mp3, "-af", ",".join(chain), "-ar", str(RATE))
    except FFmpegError:
        raise HTTPException(500, "Couldn't save the edit. Please try again.") from None
    text = meta["text"].removesuffix(" (edited)") + " (edited)"
    name = meta.get("name", "")
    name = name.removesuffix(" (edited)") + " (edited)" if name else ""
    return _store(audio, duration, text, meta["voice"], meta["rate"], meta["pitch"], name)


@router.get("/items")
def items() -> list[dict]:
    return [_item(m) for m in _all_meta()]


@router.patch("/items/{item_id}")
def rename(item_id: str, req: RenameRequest) -> dict:
    path = _meta_path(item_id)
    if not path.exists():
        raise HTTPException(404, "Voiceover not found")
    meta = {**json.loads(path.read_text()), "name": req.name.strip()}
    path.write_text(json.dumps(meta))
    return _item(meta)


@router.get("/items/{item_id}/download")
def download(item_id: str) -> FileResponse:
    path = _meta_path(item_id)
    if not path.exists():
        raise HTTPException(404, "Voiceover not found")
    # Its name, or the first few words of the script; whitespace split keeps words in any script
    # (Hindi etc.) whole.
    meta = json.loads(path.read_text())
    given = meta.get("name", "")
    words = re.sub(r'[\\/:*?"<>|.,!;()\[\]{}“”‘’…\']', "", given or strip(meta["text"])).split()
    name = "_".join(words if given else words[:6])[:60] or "voiceover"
    return FileResponse(path.with_suffix(".mp3"), media_type="audio/mpeg", filename=f"{name}.mp3")


def _delete(item_id: str) -> None:
    path = _meta_path(item_id)
    path.unlink(missing_ok=True)
    path.with_suffix(".mp3").unlink(missing_ok=True)


@router.delete("/items/{item_id}")
def delete(item_id: str) -> dict:
    _delete(item_id)
    return {"ok": True}
