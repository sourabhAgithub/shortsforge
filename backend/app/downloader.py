"""Download clips with yt-dlp (no watermark), cached by URL in data/downloads."""
import hashlib
import json
import re
import shutil
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import settings
from .config import DOWNLOADS_DIR
from .ffmpeg_util import FFmpegError, ffmpeg_dir_for_ytdlp, make_thumbnail, probe
from .jobs import Job, UserError

# Largest side <= 1920 means "up to 1080p" for both vertical and horizontal videos.
_SIZE = "[height<=1920][width<=1920]"
DEFAULT_FORMAT = (
    f"bv*{_SIZE}[vcodec^=avc1]+ba[ext=m4a]/bv*{_SIZE}+ba/b{_SIZE}/bv*+ba/b"
)
# TikTok exposes both the watermarked "download" file and clean play streams.
TIKTOK_FORMAT = (
    f"b{_SIZE}[format_note!*=watermark]/b[format_note!*=watermark]/"
    f"bv*[format_note!*=watermark]+ba/b"
)


def normalize_url(url: str) -> str:
    """Strip tracking junk so the same clip shared twice hits the cache."""
    url = url.strip()
    p = urlparse(url)
    host = (p.hostname or "").lower()
    for prefix in ("www.", "m.", "vm.", "vt."):
        if host.startswith(prefix) and host.count(".") > 1:
            host = host[len(prefix):]
    path = p.path.rstrip("/")
    query = ""
    if host in ("youtube.com", "music.youtube.com") and path == "/watch":
        v = parse_qs(p.query).get("v")
        if v:
            query = "?v=" + v[0]
    return f"{host}{path}{query}"


def cache_key(url: str) -> str:
    return hashlib.sha1(normalize_url(url).encode()).hexdigest()[:16]


def clip_meta_path(clip_id: str) -> Path:
    return DOWNLOADS_DIR / f"{clip_id}.json"


def load_clip(clip_id: str) -> dict | None:
    if not re.fullmatch(r"[A-Za-z0-9_]+", clip_id or ""):
        return None
    meta = clip_meta_path(clip_id)
    if not meta.exists():
        return None
    data = json.loads(meta.read_text())
    if not (DOWNLOADS_DIR / data["file"]).exists():
        return None
    return data


def clip_file(clip: dict) -> Path:
    return DOWNLOADS_DIR / clip["file"]


def public_clip(clip: dict) -> dict:
    """What the frontend needs to show a clip in a slot."""
    return {
        "clip_id": clip["clip_id"],
        "url": clip.get("url"),
        "title": clip.get("title") or "",
        "duration": clip["duration"],
        "width": clip["width"],
        "height": clip["height"],
        "has_audio": clip["has_audio"],
        "thumb": f"/media/downloads/{clip['thumb']}",
        "video": f"/media/downloads/{clip['file']}",
    }


def friendly_error(msg: str, browser: str, host: str = "") -> str:
    m = f"{host} {msg}".lower()
    cookie_tip = (
        "Open Settings and turn on \"Use cookies from my browser\" (pick the browser where you're "
        "logged in to Instagram), then try again."
        if browser == "none"
        else f"Make sure you're logged in to the site in {browser.title()}, close {browser.title()} "
             "completely, and try again."
    )
    if "could not find" in m and "cookies" in m or "failed to decrypt" in m or (
            "operation not permitted" in m and "cookies" in m) or "could not copy" in m:
        return (f"Couldn't read cookies from {browser.title()}. Close that browser completely and "
                "try again, or choose a different browser in Settings. (Safari on Mac needs "
                "Full Disk Access for the Terminal.)")
    if "unsupported url" in m:
        return "That link isn't a supported video link. Paste a YouTube, Instagram or TikTok video URL."
    if "private" in m:
        return "This video is private, so it can't be downloaded. " + (
            "If you can see it while logged in, use browser cookies. " + cookie_tip
            if "instagram" in m else "")
    if any(k in m for k in ("login", "log in", "logged-in", "sign in", "rate-limit", "rate limit",
                             "429", "cookies", "authentication", "restricted", "not a bot")):
        return "The site asked for a login or is rate-limiting downloads. " + cookie_tip
    if any(k in m for k in ("unavailable", "not available", "404", "has been removed",
                             "does not exist", "no video", "there is no video")):
        return "That video is unavailable. It may have been deleted, or the link has a typo."
    if any(k in m for k in ("getaddrinfo", "timed out", "connection", "network is unreachable",
                             "name or service not known", "nodename nor servname")):
        return "Couldn't reach the website. Check your internet connection and try again."
    if any(k in m for k in ("unable to extract", "403", "forbidden")):
        return ("The site blocked the download or changed its layout. Restart ShortsForge (it "
                "updates the downloader on start) and try again.")
    first = re.sub(r"^(ERROR:\s*)?(\[[\w:]+\]\s*[\w-]+:\s*)?", "", msg.strip()).splitlines()
    first = first[0] if first else ""
    return f"Download failed. {first[:200]}"


def _is_url(text: str) -> bool:
    p = urlparse(text.strip())
    return p.scheme in ("http", "https") and bool(p.hostname) and "." in p.hostname


def download(url: str, job: Job | None = None) -> dict:
    """Download (or reuse cached) clip; returns stored metadata dict."""
    url = url.strip()
    if not _is_url(url):
        raise UserError("That doesn't look like a link. Paste a full URL starting with https://")

    key = cache_key(url)
    cached = load_clip(key)
    if cached:
        if job:
            job.update(1.0, "Already downloaded")
        return cached

    import yt_dlp  # imported lazily: it is slow to import

    host = (urlparse(url).hostname or "").lower()
    browser = settings.load().get("cookies_browser", "none")

    def hook(d: dict) -> None:
        if not job:
            return
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            if total:
                job.update(0.05 + 0.85 * done / total, f"Downloading… {int(100 * done / total)}%")
        elif d.get("status") == "finished":
            job.update(0.9, "Processing…")

    tmp_dir = DOWNLOADS_DIR / f"tmp_{key}"
    shutil.rmtree(tmp_dir, ignore_errors=True)
    tmp_dir.mkdir(parents=True)
    opts = {
        "format": TIKTOK_FORMAT if "tiktok" in host else DEFAULT_FORMAT,
        "merge_output_format": "mp4",
        "outtmpl": str(tmp_dir / "clip.%(ext)s"),
        "noplaylist": True,
        "playlist_items": "1",
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "ffmpeg_location": ffmpeg_dir_for_ytdlp(),
        "progress_hooks": [hook],
        "retries": 3,
        "socket_timeout": 30,
        "overwrites": True,
    }
    if browser and browser != "none":
        opts["cookiesfrombrowser"] = (browser,)

    if job:
        job.update(0.02, "Fetching video info…")
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise UserError(friendly_error(str(e), browser, host)) from None

    if info and info.get("_type") == "playlist" and info.get("entries"):
        info = next((e for e in info["entries"] if e), info)
    files = [f for f in tmp_dir.iterdir() if f.is_file() and f.suffix not in (".part", ".ytdl")]
    videos = [f for f in files if f.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov", ".m4v")]
    if not videos:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise UserError("This post doesn't contain a video (it may be a photo post).")
    src = max(videos, key=lambda f: f.stat().st_size)
    final = DOWNLOADS_DIR / f"{key}{src.suffix.lower()}"
    shutil.move(str(src), final)
    shutil.rmtree(tmp_dir, ignore_errors=True)

    return _register(key, final, url=url, title=(info or {}).get("title") or "",
                     source=(info or {}).get("extractor_key") or host)


def register_upload(src_name: str, data_path: Path) -> dict:
    """Add a video file the user uploaded from their computer."""
    h = hashlib.sha1()
    with open(data_path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    key = "up_" + h.hexdigest()[:16]
    cached = load_clip(key)
    if cached:
        data_path.unlink(missing_ok=True)
        return cached
    suffix = Path(src_name).suffix.lower() or ".mp4"
    final = DOWNLOADS_DIR / f"{key}{suffix}"
    shutil.move(str(data_path), final)
    return _register(key, final, url=None, title=Path(src_name).stem, source="upload")


def _register(key: str, file: Path, url: str | None, title: str, source: str) -> dict:
    try:
        info = probe(file)
    except FFmpegError:
        file.unlink(missing_ok=True)
        raise UserError("The downloaded file isn't a playable video.") from None
    if info.width == 0:
        file.unlink(missing_ok=True)
        raise UserError("This file has no video track.")
    thumb = DOWNLOADS_DIR / f"{key}.jpg"
    try:
        make_thumbnail(file, thumb)
    except FFmpegError:
        pass
    meta = {
        "clip_id": key, "url": url, "title": title, "source": source,
        "file": file.name, "thumb": thumb.name,
        "duration": round(info.duration, 3), "width": info.width, "height": info.height,
        "has_audio": info.has_audio,
    }
    clip_meta_path(key).write_text(json.dumps(meta, indent=2))
    return meta
