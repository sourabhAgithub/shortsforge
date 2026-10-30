"""Footage for each scene, in priority order:

1. the user's own upload for the scene
2. AI-generated image from the scene's prompt (pluggable provider, see PROVIDERS)
3. stock video/photo from Pexels or Pixabay (needs PEXELS_API_KEY or PIXABAY_API_KEY)
4. an animated gradient (always works, drawn at render time)
"""
import json
import os
import random
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

from ...config import AIVIDEO_DIR
from ...ffmpeg_util import FFmpegError, make_thumbnail, probe
from ...jobs import UserError
from ...textdraw import plain
from .models import Footage, Scene

PROMPT_SUFFIX = "vertical 9:16, cinematic, no text"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
UA = "ShortsForge/1.0 (local app)"
GRADIENTS = [("#1941e3", "#4bb5ff"), ("#7c3aed", "#ec4899"), ("#0f766e", "#22d3ee"),
             ("#b45309", "#f43f5e"), ("#1e3a8a", "#a855f7"), ("#065f46", "#84cc16")]


def project_dir(project_id: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", project_id):
        raise UserError("Invalid project")
    d = AIVIDEO_DIR / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def media_url(project_id: str, name: str) -> str:
    return f"/media/aivideo/{project_id}/{name}"


def _http(url: str, headers: dict | None = None, timeout: float = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# ---------- AI image providers ----------

class PollinationsProvider:
    """Text-to-image from pollinations.ai. Without a key the free tier allows about one image
    every 45 seconds per computer, so requests are queued and we wait out the limit. A key
    (POLLINATIONS_TOKEN) removes the wait and the small corner logo."""
    name = "pollinations"
    key_env = "POLLINATIONS_TOKEN"
    MAX_WAITS = 12
    _lock = threading.Lock()  # the free tier rejects parallel requests

    def available(self) -> bool:
        return True

    def generate(self, prompt: str, seed: int, out: Path, on_wait=None) -> Path:
        q = urllib.parse.urlencode({"width": 1080, "height": 1920, "seed": seed, "nologo": "true",
                                    "model": os.environ.get("POLLINATIONS_MODEL", "flux")})
        url = f"https://image.pollinations.ai/prompt/{urllib.parse.quote(prompt)}?{q}"
        token = os.environ.get(self.key_env, "").strip()
        headers = {"Authorization": f"Bearer {token}"} if token else None
        with self._lock:
            for _ in range(self.MAX_WAITS):
                try:
                    data = _http(url, headers, timeout=180)
                    break
                except urllib.error.HTTPError as e:
                    if e.code not in (402, 429):
                        raise
                    body = e.read().decode("utf-8", "replace")
                    m = re.search(r"[Rr]etry after (\d+)", body)
                    delay = min(int(m.group(1)) + 2 if m else 30, 90)
                    if on_wait:
                        on_wait(delay)
                    time.sleep(delay)
            else:
                raise RuntimeError("the free AI image limit kept blocking requests")
        if len(data) < 5000:
            raise RuntimeError("the image service returned an empty image")
        out = out.with_suffix(".jpg")
        out.write_bytes(data)
        Image.open(out).verify()
        return out


# To add a provider: write a class with name / key_env / available() / generate(), add it here,
# and set AI_IMAGE_PROVIDER=<name> in .env.
PROVIDERS = {p.name: p for p in [PollinationsProvider()]}


def ai_provider():
    name = os.environ.get("AI_IMAGE_PROVIDER", "pollinations").strip().lower()
    p = PROVIDERS.get(name)
    return p if p and p.available() else None


def ai_prompt(prompt: str) -> str:
    base = plain(prompt).strip(" ,.") or "abstract cinematic background"
    return f"{base}, {PROMPT_SUFFIX}"


# ---------- Pexels stock ----------

_STOP = set("""a an the and or of in on at to from with without into over under above below then
both all its it is are be by for as up down around about big small icon icons label text shot view
showing show zooming zoom circling spinning""".split())


def keywords(prompt: str, n: int = 4) -> str:
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z'’-]+", plain(prompt).lower()) if w not in _STOP]
    return " ".join(words[:n]) or "abstract background"


def pexels(prompt: str, out: Path) -> tuple[Path, str]:
    key = os.environ.get("PEXELS_API_KEY", "").strip()
    if not key:
        raise RuntimeError("PEXELS_API_KEY is not set")
    q = urllib.parse.quote(keywords(prompt))
    headers = {"Authorization": key}
    res = json.loads(_http(f"https://api.pexels.com/videos/search?query={q}&orientation=portrait"
                           "&per_page=10", headers, timeout=30))
    for v in res.get("videos", []):
        files = [f for f in v.get("video_files", []) if f.get("file_type") == "video/mp4"
                 and (f.get("height") or 0) > (f.get("width") or 0) and (f.get("height") or 0) <= 1920]
        if files:
            best = max(files, key=lambda f: f["height"])
            path = out.with_suffix(".mp4")
            path.write_bytes(_http(best["link"], timeout=120))
            return path, "video"
    res = json.loads(_http(f"https://api.pexels.com/v1/search?query={q}&orientation=portrait"
                           "&per_page=5", headers, timeout=30))
    for p in res.get("photos", []):
        src = p.get("src", {}).get("portrait") or p.get("src", {}).get("large2x")
        if src:
            path = out.with_suffix(".jpg")
            path.write_bytes(_http(src, timeout=60))
            return path, "image"
    raise RuntimeError(f'no stock results for "{keywords(prompt)}"')


def pixabay(prompt: str, out: Path) -> tuple[Path, str]:
    key = os.environ.get("PIXABAY_API_KEY", "").strip()
    if not key:
        raise RuntimeError("PIXABAY_API_KEY is not set")
    q = urllib.parse.quote(keywords(prompt))
    base = f"key={urllib.parse.quote(key)}&q={q}&safesearch=true"
    res = json.loads(_http(f"https://pixabay.com/api/videos/?{base}&per_page=20", timeout=30))
    # Pixabay has no orientation filter for videos: prefer vertical clips, else crop a landscape one.
    candidates = []
    for hit in res.get("hits", []):
        files = [f for f in (hit.get("videos") or {}).values()
                 if f.get("url") and 0 < max(f.get("width") or 0, f.get("height") or 0) <= 1920]
        if files:
            best = max(files, key=lambda f: f["width"] * f["height"])
            candidates.append((best["height"] > best["width"], best))
    if candidates:
        best = next((f for vertical, f in candidates if vertical), candidates[0][1])
        path = out.with_suffix(".mp4")
        path.write_bytes(_http(best["url"], timeout=120))
        return path, "video"
    res = json.loads(_http(f"https://pixabay.com/api/?{base}&orientation=vertical&image_type=photo"
                           "&per_page=5", timeout=30))
    for hit in res.get("hits", []):
        if hit.get("largeImageURL"):
            path = out.with_suffix(".jpg")
            path.write_bytes(_http(hit["largeImageURL"], timeout=60))
            return path, "image"
    raise RuntimeError(f'no stock results for "{keywords(prompt)}"')


def stock(prompt: str, out: Path) -> tuple[Path, str]:
    """Search whichever stock libraries have a key: Pexels first, then Pixabay."""
    sources = [fn for env, fn in (("PEXELS_API_KEY", pexels), ("PIXABAY_API_KEY", pixabay))
               if os.environ.get(env, "").strip()]
    if not sources:
        raise RuntimeError("no stock key set (PIXABAY_API_KEY or PEXELS_API_KEY)")
    errors = []
    for fn in sources:
        try:
            return fn(prompt, out)
        except Exception as e:
            errors.append(f"{fn.__name__}: {_short(e)}")
    raise RuntimeError("; ".join(errors))


# ---------- thumbnails / uploads / gradient ----------

def image_thumb(src: Path, out: Path) -> None:
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    im.thumbnail((360, 640))
    im.save(out, quality=85)


def gradient_thumb(index: int, out: Path) -> None:
    c0, c1 = GRADIENTS[index % len(GRADIENTS)]
    im = Image.new("RGB", (180, 320))
    a, b = Image.new("RGB", (1, 1), c0).getpixel((0, 0)), Image.new("RGB", (1, 1), c1).getpixel((0, 0))
    d = ImageDraw.Draw(im)
    for y in range(320):
        t = y / 319
        d.line([(0, y), (180, y)], fill=tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)))
    im.save(out, quality=85)


def _finish(project_id: str, path: Path, kind: str, source: str, note: str = "") -> Footage:
    thumb = path.with_name(path.stem + "_thumb.jpg")
    try:
        if kind == "image":
            image_thumb(path, thumb)
        else:
            make_thumbnail(path, thumb, at=0.5, width=360)
    except (OSError, FFmpegError):
        raise RuntimeError("the file isn't a readable image/video") from None
    return Footage(kind=kind, source=source, file=path.name, thumb=media_url(project_id, thumb.name),
                   note=note)


def save_upload(project_id: str, filename: str, src: Path) -> Footage:
    ext = Path(filename).suffix.lower()
    if ext not in IMAGE_EXTS | VIDEO_EXTS:
        src.unlink(missing_ok=True)
        raise UserError("Please choose an image (jpg, png, webp) or a video (mp4, mov, webm).")
    d = project_dir(project_id)
    dest = d / f"upload_{uuid.uuid4().hex[:8]}{'.jpg' if ext in IMAGE_EXTS else ext}"
    try:
        if ext in IMAGE_EXTS:
            ImageOps.exif_transpose(Image.open(src)).convert("RGB").save(dest, quality=92)
            src.unlink(missing_ok=True)
            return _finish(project_id, dest, "image", "upload")
        shutil.move(str(src), dest)
        if probe(dest).width == 0:
            raise RuntimeError
        return _finish(project_id, dest, "video", "upload")
    except Exception:
        src.unlink(missing_ok=True)
        dest.unlink(missing_ok=True)
        raise UserError("That file couldn't be opened. Try a different image or video.") from None


def clean_image(project_id: str, name: str, box: tuple[float, float, float, float]) -> Footage:
    """Paint over a watermark or logo inside `box` (x, y, w, h as fractions of the image) and save
    the result as a new upload; the original file is kept so the change can be undone.

    The box is filled from its surroundings first; pixels that differ a lot from that fill are the
    mark itself, and only those (slightly widened) are painted, so the rest of the box keeps its
    real detail. If nothing stands out, the whole box is painted.
    """
    import cv2
    import numpy as np

    src = project_dir(project_id) / name
    if not re.fullmatch(r"[\w.-]+", name) or src.suffix.lower() not in IMAGE_EXTS or not src.exists():
        raise UserError("That photo isn't in this project any more. Upload it again.")
    img = cv2.imread(str(src))
    if img is None:
        raise UserError("That photo couldn't be opened.")
    h, w = img.shape[:2]
    x, y, bw, bh = box
    x0, y0 = max(0, round(x * w)), max(0, round(y * h))
    x1, y1 = min(w, round((x + bw) * w)), min(h, round((y + bh) * h))
    if x1 - x0 < 3 or y1 - y0 < 3:
        raise UserError("Draw a bigger box around the watermark.")
    area = np.zeros((h, w), np.uint8)
    area[y0:y1, x0:x1] = 255

    fill = cv2.inpaint(img, area, 5, cv2.INPAINT_TELEA)
    mark = ((cv2.absdiff(img, fill).max(axis=2) > 28) & (area > 0)).astype(np.uint8) * 255
    mark = cv2.dilate(mark, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=2) & area
    if cv2.countNonZero(mark) < 0.02 * cv2.countNonZero(area):
        mark = area
    out = cv2.inpaint(img, mark, 4, cv2.INPAINT_TELEA)
    # The fill is perfectly smooth; add grain like the photo's around the box so it blends in.
    near = cv2.dilate(area, np.ones((41, 41), np.uint8)) & ~area
    grain = (img.astype(np.float32) - cv2.GaussianBlur(img, (0, 0), 2).astype(np.float32))[near > 0].std()
    noise = np.random.default_rng(0).normal(0, grain, img.shape).astype(np.float32)
    painted = mark > 0
    out[painted] = np.clip(out[painted].astype(np.float32) + noise[painted], 0, 255).astype(np.uint8)

    dest = project_dir(project_id) / f"upload_{uuid.uuid4().hex[:8]}.jpg"
    cv2.imwrite(str(dest), out, [cv2.IMWRITE_JPEG_QUALITY, 95])
    return _finish(project_id, dest, "image", "upload")


def remove_footage(project_id: str, f: Footage | None) -> None:
    """Delete generated footage files we no longer need (never the user's uploads)."""
    if not f or f.source == "upload":
        return
    d = project_dir(project_id)
    if f.file:
        (d / f.file).unlink(missing_ok=True)
    if f.thumb:
        (d / Path(f.thumb).name).unlink(missing_ok=True)


def build(project_id: str, scene: Scene, index: int, mode: str, on_wait=None) -> Footage:
    """Find footage for one scene using the priority list; never raises."""
    if scene.upload and scene.upload.file and (project_dir(project_id) / scene.upload.file).exists():
        return scene.upload
    d = project_dir(project_id)
    base = d / f"scene_{scene.id}_{uuid.uuid4().hex[:6]}"
    notes = []
    if mode == "ai":
        provider = ai_provider()
        if provider:
            try:
                path = provider.generate(ai_prompt(scene.prompt or scene.label or scene.voiceover),
                                         random.randint(1, 10**6), base, on_wait)
                return _finish(project_id, path, "image", "ai")
            except Exception as e:
                notes.append(f"AI image failed ({_short(e)})")
        else:
            notes.append("no AI provider configured")
    if mode in ("ai", "stock"):
        try:
            path, kind = stock(scene.prompt or scene.label or scene.voiceover, base)
            return _finish(project_id, path, kind, "stock", "; ".join(notes))
        except Exception as e:
            notes.append(f"stock search failed ({_short(e)})")
    thumb = base.with_name(base.name + "_thumb.jpg")
    gradient_thumb(index, thumb)
    if mode == "uploads":
        notes.append("no upload for this scene")
    return Footage(kind="gradient", source="gradient", file=None,
                   thumb=media_url(project_id, thumb.name), note="; ".join(notes))


def _short(e: Exception) -> str:
    msg = str(e) or type(e).__name__
    if isinstance(e, urllib.error.HTTPError):
        msg = f"HTTP {e.code}"
    elif isinstance(e, (urllib.error.URLError, TimeoutError)):
        msg = "couldn't reach the service"
    return msg.splitlines()[0][:120]
