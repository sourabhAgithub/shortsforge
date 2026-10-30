"""HTTP routes for the AI Voiceover tool, mounted at /api/voiceover.

Free voices come from edge-tts (Microsoft's neural voices behind Edge's "Read aloud"): no API key,
hundreds of voices in many languages. With ELEVENLABS_API_KEY set, ElevenLabs voices are added too.
Both need an internet connection. Scripts can carry delivery tags such as [whispers] or [pause]
(see tags.py)."""
import asyncio
import json
import re
import shutil
import time
import uuid

import aiohttp
import edge_tts
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from ...config import VOICEOVER_DIR, WORK_DIR
from ...ffmpeg_util import FFmpegError, run_ffmpeg
from . import elevenlabs
from .tags import Say, parse, strip

router = APIRouter()
MAX_CHARS = 20_000
KEEP = 50  # newest voiceovers kept on disk; older ones are deleted
BITRATE = 48_000  # edge-tts sends 24 kHz 48 kbit/s mono MP3 (constant bitrate)
SAMPLE_RATE = 24_000
_voices: list[dict] = []
_eleven: list[dict] = []


class SpeakRequest(BaseModel):
    text: str
    voice: str
    rate: int = Field(0, ge=-50, le=100)  # percent faster (+) or slower (-); free voices only
    pitch: int = Field(0, ge=-50, le=50)  # Hz higher (+) or lower (-); free voices only


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
    return {**meta, "url": f"/media/voiceover/{meta['id']}.mp3",
            "download": f"/api/voiceover/items/{meta['id']}/download"}


def _all_meta() -> list[dict]:
    out = []
    for f in VOICEOVER_DIR.glob("*.json"):
        try:
            out.append(json.loads(f.read_text()))
        except (OSError, ValueError):
            continue
    return sorted(out, key=lambda m: m["created_at"], reverse=True)


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
    item_id = uuid.uuid4().hex[:12]
    (VOICEOVER_DIR / f"{item_id}.mp3").write_bytes(audio)
    meta = {"id": item_id, "text": req.text.strip(), "voice": req.voice, "rate": req.rate,
            "pitch": req.pitch, "duration": round(len(audio) * 8 / bitrate, 2),
            "created_at": time.time()}
    _meta_path(item_id).write_text(json.dumps(meta))
    for old in _all_meta()[KEEP:]:
        _delete(old["id"])
    return _item(meta)


@router.get("/items")
def items() -> list[dict]:
    return [_item(m) for m in _all_meta()]


@router.get("/items/{item_id}/download")
def download(item_id: str) -> FileResponse:
    path = _meta_path(item_id)
    if not path.exists():
        raise HTTPException(404, "Voiceover not found")
    # First few words of the script; whitespace split keeps words in any script (Hindi etc.) whole.
    words = re.sub(r'[\\/:*?"<>|.,!;()\[\]{}“”‘’…\']', "", strip(json.loads(path.read_text())["text"])).split()
    name = "_".join(words[:6])[:60] or "voiceover"
    return FileResponse(path.with_suffix(".mp3"), media_type="audio/mpeg", filename=f"{name}.mp3")


def _delete(item_id: str) -> None:
    path = _meta_path(item_id)
    path.unlink(missing_ok=True)
    path.with_suffix(".mp3").unlink(missing_ok=True)


@router.delete("/items/{item_id}")
def delete(item_id: str) -> dict:
    _delete(item_id)
    return {"ok": True}
