"""Free sound effects from Wikimedia Commons, which needs no account or key.

Commons holds speech and music too, so its sound effects category is searched first and everything
else is filtered to sounds whose title names what was asked for. Only licences that allow reuse are kept, safest first; the credit travels with the
clip so the ones that require it can be given.
"""
import hashlib
import html
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

from ... import jobs
from ...ffmpeg_util import FFmpegError, probe, run_ffmpeg
from . import footage as ft
from .models import MediaFile

SEARCH_URL = "https://commons.wikimedia.org/w/api.php"
FILES_URL = "https://upload.wikimedia.org/"
USER_AGENT = "ShortsForge/1.0 (local video tool)"  # Wikimedia refuses requests without one
MAX_OPTIONS = 4
SHORTEST, LONGEST = 0.2, 300.0  # seconds
MAX_BYTES = 40 * 1024 * 1024

LONG = 60.0  # longer than this is a last resort: it needs trimming before it's any use
MAX_TITLE_WORDS = 7  # a whole sentence as a title is a language lesson reading it aloud
PAUSE = 1.5  # seconds between searches; Wikimedia refuses rapid requests
SFX_CATEGORY = 'deepcat:"Sound effects"'

# Pronunciation recordings, spoken articles, songs and the like, which match words but aren't sounds.
NOT_SFX = re.compile(r"^(ll-q|[a-z]{2,3}(-[a-z]{2,4})?-)|pronunciation|speech|address|spoken|interview"
                     r"|wikipedia|\bsong\b|\bhymn\b|\bchoir\b|\bsonata\b|orchestra|\bband\b|\(1[89]\d\d\)"
                     r"|\balbum\b| - \d\d - |\bclick track\b|alveolar|velar|palatal|consonant|example\b"
                     r"|\bisrc\b|\bbpm\b|ringtone|kevin macleod|zero project|\bbgm\b")
SKIP_WORDS = {"sound", "sounds", "effect", "effects", "noise", "the", "a", "an", "of", "on", "in"}
# Words that describe a sound rather than name it. Searched alone, they find anything.
MOOD_WORDS = {"soft", "eerie", "creepy", "scary", "spooky", "distant", "faint", "loud", "quiet", "heavy",
              "light", "low", "slow", "fast", "dark", "sneaky", "midnight", "gentle", "sudden", "strange"}


def _get(url: str, timeout: float = 20):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}),
                                  timeout=timeout)


def _words(name: str) -> list[str]:
    return [w for w in re.findall(r"[a-z]+", name.lower()) if w not in SKIP_WORDS]


def _queries(name: str) -> list[str]:
    """The whole name, then its words from the last: the sound itself is usually the last word."""
    words = _words(name)
    return list(dict.fromkeys([" ".join(words), *(w for w in reversed(words) if w not in MOOD_WORDS)]))


def _licence_rank(licence: str) -> int | None:
    text = licence.lower()
    if "cc0" in text or text.startswith(("public domain", "pd")):
        return 0
    if re.match(r"cc[ -]by[ -]\d", text):
        return 1
    if re.match(r"cc[ -]by-sa[ -]\d", text):
        return 2
    return None


def _clean(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value or "")).strip()


def _title(page_title: str) -> str:
    return re.sub(r"[_-]+", " ", Path(page_title.removeprefix("File:")).stem).strip()


def _search(query: str, retry: bool = True) -> list[dict]:
    params = {"action": "query", "format": "json", "generator": "search", "gsrnamespace": 6,
              "gsrsearch": f"{query} filetype:audio", "gsrlimit": 30, "prop": "imageinfo",
              "iiprop": "url|size|mime|extmetadata", "iiextmetadatafilter": "LicenseShortName|Artist|ImageDescription"}
    try:
        with _get(f"{SEARCH_URL}?{urllib.parse.urlencode(params)}") as r:
            return list(json.load(r).get("query", {}).get("pages", {}).values())
    except OSError:  # includes being told to slow down
        if not retry:
            raise
        time.sleep(5)
        return _search(query, retry=False)


def _about(description: str, title: str) -> str:
    """What the uploader says the sound is, unless that only repeats the title."""
    text = " ".join(_clean(description).split())
    if text.lower().startswith("title ") or text.lower().strip('"').startswith(title.lower()[:12]):
        return ""
    return text[:160]


def _option(page: dict) -> dict | None:
    info = (page.get("imageinfo") or [{}])[0]
    meta = info.get("extmetadata", {})
    licence = _clean(meta.get("LicenseShortName", {}).get("value", ""))
    name = page.get("title", "").removeprefix("File:").lower()
    if (not SHORTEST <= (info.get("duration") or 0) <= LONGEST or "midi" in info.get("mime", "")
            or info.get("size", MAX_BYTES + 1) > MAX_BYTES or NOT_SFX.search(name)
            or len(_title(page["title"]).split()) > MAX_TITLE_WORDS
            or _licence_rank(licence) is None or not info.get("url", "").startswith(FILES_URL)):
        return None
    return {"title": _title(page["title"]), "url": info["url"], "duration": round(info["duration"], 2),
            "licence": licence, "artist": _clean(meta.get("Artist", {}).get("value", ""))[:80],
            "about": _about(meta.get("ImageDescription", {}).get("value", ""), _title(page["title"])),
            "page": info.get("descriptionurl", "")}


def find_options(name: str) -> list[dict]:
    """Up to MAX_OPTIONS downloads for a sound, best first. Empty if Commons can't be reached."""
    wanted = [w[:5] for w in _words(name)]  # "whistling" should find "whistle"
    found: dict[str, tuple] = {}
    searches = [(q, c) for q in _queries(name) for c in (True, False)]
    try:
        for query, in_category in searches:
            time.sleep(PAUSE)
            stem = [w[:5] for w in _words(query)]
            for page in _search(f"{query} {SFX_CATEGORY}" if in_category else query):
                option = _option(page)
                title = page.get("title", "").lower()
                if option and all(w in title for w in stem) and option["url"] not in found:
                    found[option["url"]] = (sum(w not in title for w in wanted), option["duration"] > LONG,
                                            not in_category, _licence_rank(option["licence"]), option)
            if sum(not v[0] and not v[1] for v in found.values()) >= MAX_OPTIONS - 1:
                break
    except (OSError, ValueError, KeyError):  # no internet, or a garbled reply
        pass
    return [v[-1] for v in sorted(found.values(), key=lambda v: v[:4])[:MAX_OPTIONS]]


def fetch(project_id: str, url: str, title: str) -> MediaFile:
    """Download into the project as MP3, which every browser plays. The same sound is kept once."""
    if not url.startswith(FILES_URL):
        raise jobs.UserError("That sound isn't from the free library.")
    folder = ft.project_dir(project_id)
    dest = folder / f"sound_web_{hashlib.sha1(url.encode()).hexdigest()[:10]}.mp3"
    if not dest.exists():
        tmp = dest.with_name(f"{dest.stem}.download")
        try:
            with _get(url, 60) as r, tmp.open("wb") as f:
                while chunk := r.read(1 << 16):
                    f.write(chunk)
                    if f.tell() > MAX_BYTES:
                        raise jobs.UserError("That sound is too large to download.")
            run_ffmpeg(["-i", str(tmp), "-vn", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame",
                        "-b:a", "160k", str(dest)])
        except (OSError, FFmpegError) as e:
            dest.unlink(missing_ok=True)
            raise jobs.UserError("Couldn't download that sound. Try another one.") from e
        finally:
            tmp.unlink(missing_ok=True)
    info = probe(dest)
    return MediaFile(file=dest.name, name=title[:60] or dest.name, duration=round(info.duration, 3),
                     url=ft.media_url(project_id, dest.name))
