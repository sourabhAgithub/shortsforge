"""Turn a puppet project into a 1080x1920 / 30fps Short.

Each frame is drawn with Pillow from the poses in motions.timeline() and piped to FFmpeg, so a
long video never holds more than one frame in memory. The joint maths matches drawFigure() in
frontend/src/tools/puppet/figure.ts."""
import math
import os
import subprocess
import time
from pathlib import Path

from PIL import Image

from ... import videos
from ...config import PUPPET_DIR
from ...ffmpeg_util import FFmpegError, ffmpeg_exe, make_thumbnail, probe
from ...jobs import Job, UserError
from .models import PuppetProject
from .motions import FPS, JOINTS, timeline

W, H = 1080, 1920
GROUND = 0.82  # feet stand this far down the frame
MAX_SECONDS = 180
PX = 2  # part images hold 2 pixels per figure unit (800x1600 for the 400x800 figure)
FEET = (200, 780)
HIP = (200, 470)
NECK = (200, 215)
JOINT = {"head": NECK, "armL": (150, 245), "armR": (250, 245), "legL": (170, 470), "legR": (230, 470)}
LAYERS = ("legL", "legR", "torso", "armL", "armR", "head")  # back to front

Matrix = tuple[float, float, float, float, float, float]  # x' = ax+by+c, y' = dx+ey+f


def _mul(m: Matrix, n: Matrix) -> Matrix:
    a, b, c, d, e, f = m
    g, h, i, j, k, l = n
    return (a * g + b * j, a * h + b * k, a * i + b * l + c,
            d * g + e * j, d * h + e * k, d * i + e * l + f)


def _rot(deg: float, at: tuple[float, float]) -> Matrix:
    s, c = math.sin(math.radians(deg)), math.cos(math.radians(deg))
    x, y = at
    return (c, -s, x - c * x + s * y, s, c, y - s * x - c * y)


def media_dir(project_id: str) -> Path:
    d = PUPPET_DIR / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _place(frame: Image.Image, layer: Image.Image, origin: tuple[int, int], m: Matrix) -> None:
    """Draw a cropped, premultiplied part image; `m` maps its full image's pixels to the frame."""
    ox, oy = origin
    m = _mul(m, (1, 0, ox, 0, 1, oy))
    w, h = layer.size
    xs = [m[0] * x + m[1] * y + m[2] for x, y in ((0, 0), (w, 0), (0, h), (w, h))]
    ys = [m[3] * x + m[4] * y + m[5] for x, y in ((0, 0), (w, 0), (0, h), (w, h))]
    x0, y0 = max(math.floor(min(xs)), 0), max(math.floor(min(ys)), 0)
    x1, y1 = min(math.ceil(max(xs)), W), min(math.ceil(max(ys)), H)
    if x1 <= x0 or y1 <= y0:
        return
    a, b, c, d, e, f = m
    det = a * e - b * d
    # Inverse map, from the output box back to the part image.
    inv = (e / det, -b / det, (b * (f - y0) - e * (c - x0)) / det,
           -d / det, a / det, (d * (c - x0) - a * (f - y0)) / det)
    piece = layer.transform((x1 - x0, y1 - y0), Image.AFFINE, inv, Image.BILINEAR)
    frame.alpha_composite(piece.convert("RGBA"), (x0, y0))


def draw_figure(frame: Image.Image, parts: dict, row: list[float], scale: float) -> None:
    x, flip, *rest = row
    pose = dict(zip(JOINTS, rest))
    fx, fy = FEET
    base: Matrix = (scale * flip, 0, x * W - scale * flip * fx, 0, scale, GROUND * H - scale * fy)
    base = _mul(base, (1, 0, 0, 0, 1, pose["y"]))
    root = _mul(base, _rot(pose["root"], FEET))
    body = _mul(root, _rot(pose["body"], HIP))
    for name in LAYERS:
        if name not in parts:
            continue
        if name == "torso":
            m = body
        else:
            m = _mul(root if name.startswith("leg") else body, _rot(pose[name], JOINT[name]))
        image, origin = parts[name]
        _place(frame, image, origin, _mul(m, (1 / PX, 0, 0, 0, 1 / PX, 0)))


def load_parts(p: PuppetProject) -> dict:
    """Each drawn part, cropped to its ink (so frames only touch the pixels they need)."""
    out = {}
    for name, file in p.parts.items():
        path = media_dir(p.id) / file
        if not path.exists():
            continue
        img = Image.open(path).convert("RGBA")
        box = img.getbbox()
        if box:
            out[name] = (img.crop(box).convert("RGBa"), box[:2])
    return out


def background(p: PuppetProject) -> Image.Image:
    bg = Image.new("RGBA", (W, H), p.bg_color)
    bg.paste(p.ground_color, (0, round(GROUND * H) - 10, W, H))
    return bg


def render(p: PuppetProject, job: Job | None = None) -> dict:
    parts = load_parts(p)
    if not parts:
        raise UserError("Draw your figure first (step 1).")
    frames = timeline(p.actions, p.start_x)
    if not frames:
        raise UserError("Add at least one action (step 2).")
    if len(frames) > MAX_SECONDS * FPS:
        raise UserError(f"That's too long. Keep the actions under {MAX_SECONDS // 60} minutes in total.")

    video_id = videos.new_id()
    mp4, jpg, _ = videos.paths(video_id)
    dur = len(frames) / FPS
    threads = os.environ.get("FFMPEG_THREADS")
    cmd = [ffmpeg_exe(), "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0",
           "-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high",
           "-vf", "scale=out_range=tv,format=yuv420p", "-color_range", "tv", "-c:a", "aac",
           "-b:a", "128k", "-t", f"{dur:.3f}", "-movflags", "+faststart",
           *(["-threads", threads] if threads else []), str(mp4)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    bg = background(p)
    last_row, data = None, b""
    try:
        for i, row in enumerate(frames):
            if row != last_row:  # a held pose reuses the frame it just drew
                frame = bg.copy()
                draw_figure(frame, parts, row, p.scale)
                data, last_row = frame.convert("RGB").tobytes(), row
            proc.stdin.write(data)
            if job and i % 15 == 0:
                job.update(0.02 + 0.9 * i / len(frames), "Animating your story…")
        proc.stdin.close()
        err = proc.stderr.read().decode(errors="replace")
        if proc.wait() != 0:
            raise FFmpegError(err[-500:])
    except BrokenPipeError:
        proc.wait()
        raise FFmpegError(proc.stderr.read().decode(errors="replace")[-500:]) from None
    finally:
        if proc.poll() is None:
            proc.kill()

    if job:
        job.update(0.95, "Making the thumbnail…")
    make_thumbnail(mp4, jpg, at=min(1.0, dur / 2))
    return videos.save_meta({
        "id": video_id, "tool": "puppet", "title": " ".join(p.title.split()) or "Untitled story",
        "project_id": p.id, "created_at": time.time(), "duration": round(probe(mp4).duration, 2),
    })
