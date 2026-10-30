"""ElevenLabs voices (optional, needs ELEVENLABS_API_KEY). Its v3 model reads delivery tags like
[whispers], [nervous] or [long pause] itself, so the script is sent as typed."""
import logging
import os

import aiohttp
from fastapi import HTTPException

from .tags import chunks

API = "https://api.elevenlabs.io/v1"
PREFIX = "eleven:"  # voice ids from ElevenLabs are stored as "eleven:<voice_id>"
LOCALE = "elevenlabs"
LANGUAGE = "★ ElevenLabs: expressive, any language"
CHUNK = 2800  # v3 takes up to 3,000 characters per request
BITRATE = 128_000  # mp3_44100_128
SAMPLE_RATE = 44_100
log = logging.getLogger(__name__)


def key() -> str:
    return os.environ.get("ELEVENLABS_API_KEY", "").strip()


def model() -> str:
    return os.environ.get("ELEVENLABS_MODEL", "").strip() or "eleven_v3"


async def _error(res: aiohttp.ClientResponse) -> HTTPException:
    try:
        detail = (await res.json()).get("detail", {})
    except (aiohttp.ContentTypeError, ValueError):
        detail = {}
    status = detail.get("status", "") if isinstance(detail, dict) else ""
    message = detail.get("message", "") if isinstance(detail, dict) else str(detail)
    if res.status == 401 and status != "quota_exceeded":
        return HTTPException(400, "ElevenLabs didn't accept the API key. Check ELEVENLABS_API_KEY in "
                                  "your .env file and restart the app.")
    if status == "quota_exceeded" or res.status == 402:
        return HTTPException(400, "Your ElevenLabs credits are used up for this month. Top up on "
                                  "elevenlabs.io, or pick one of the free voices.")
    return HTTPException(502, f"ElevenLabs couldn't make the voice: {message or res.reason}")


async def voices() -> list[dict]:
    """The voices in the account (premade + your own); empty without a key or if the key fails."""
    if not key():
        return []
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as s:
            async with s.get(f"{API}/voices", headers={"xi-api-key": key()}) as res:
                if res.status != 200:
                    log.warning("ElevenLabs voice list failed: %s", (await _error(res)).detail)
                    return []
                raw = (await res.json())["voices"]
    except (TimeoutError, aiohttp.ClientError, KeyError, ValueError):
        log.warning("Couldn't load the ElevenLabs voice list", exc_info=True)
        return []
    out = []
    for v in raw:
        labels = v.get("labels") or {}
        styles = [labels.get(k, "").replace("_", " ").capitalize() for k in ("accent", "description", "descriptive", "use_case")]
        out.append({"id": PREFIX + v["voice_id"], "name": v["name"].split(" - ")[0],
                    "gender": (labels.get("gender") or "").capitalize(), "locale": LOCALE,
                    "language": LANGUAGE, "styles": [s for s in styles if s][:3],
                    "sample": v.get("preview_url")})
    return sorted(out, key=lambda v: v["name"])


async def speak(text: str, voice: str) -> list[bytes]:
    """MP3 audio for the script, one piece per chunk of it."""
    out = []
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=240)) as s:
        for piece in chunks(text, CHUNK):
            async with s.post(f"{API}/text-to-speech/{voice.removeprefix(PREFIX)}",
                              params={"output_format": "mp3_44100_128"},
                              headers={"xi-api-key": key()},
                              json={"text": piece, "model_id": model()}) as res:
                if res.status != 200:
                    raise await _error(res)
                out.append(await res.read())
    return out
