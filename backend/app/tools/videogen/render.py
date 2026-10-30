"""Turn a Video Generator project into a 1080x1920 / 30fps / H.264+AAC Short in one FFmpeg pass.

The trimmed video is framed to 9:16 (same framing as the AI Video tool), then every text and
caption PNG is overlaid during its time window. The video's own sound (unless muted) and the
external audio are mixed over a silent base track, so there is always audio of the right length.
"""
import shutil
import time
from pathlib import Path

from PIL import Image, ImageDraw

from ... import textdraw as td
from ... import videos
from ...config import VIDEOGEN_DIR, WORK_DIR
from ...ffmpeg_util import make_thumbnail, probe, run_ffmpeg
from ...jobs import Job, UserError
from ..aivideo.overlay import H, W, _lines_block
from ..aivideo.render import FPS, _frame
from .models import Cue, TextItem, VgProject


def media_dir(project_id: str) -> Path:
    d = VIDEOGEN_DIR / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def window(p: VgProject) -> tuple[float, float]:
    """The part of the source video that's used, in source seconds."""
    length = p.video.duration if p.video else 0.0
    start = min(max(p.settings.trim_start, 0.0), length)
    end = length if p.settings.trim_end is None else min(max(p.settings.trim_end, start), length)
    return start, end


def _lines(text: str, max_w: int, size: int) -> tuple[list[str], int]:
    """Lines (typed line breaks kept, long lines split in two) and a size that fits max_w."""
    lines = [l for para in text.split("\n") if para.split()
             for l in td.wrap_balanced(" ".join(para.split()), max_w, size)]
    return lines, td.fit_size(lines, max_w, size) if lines else size


def text_image(t: TextItem) -> Image.Image | None:
    if not td.runs(t.text.replace("\n", " ").strip()):
        return None
    if not t.box:
        lines, size = _lines(t.text, 1000, t.size)
        return _lines_block(lines, size, t.color, 0.11)
    lines, size = _lines(t.text, 940, t.size)
    block = _lines_block(lines, size, t.color, 0.07)
    pad_x, pad_y = 44, 26
    img = Image.new("RGBA", (block.width + 2 * pad_x, block.height + 2 * pad_y), (0, 0, 0, 0))
    rgb = tuple(int(t.box_color[i:i + 2], 16) for i in (1, 3, 5))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius=34,
                                          fill=rgb + (235,))
    img.alpha_composite(block, (pad_x, pad_y))
    return img


def caption_image(text: str, size: int, color: str) -> Image.Image | None:
    if not td.runs(text.strip()):
        return None
    lines, size = _lines(text, 1000, size)
    return _lines_block(lines, size, color, 0.11)


def group_words(words: list[tuple[str, float, float]], max_words: int = 3) -> list[Cue]:
    """Captions of up to `max_words` words, breaking early at pauses and sentence ends."""
    cues: list[Cue] = []
    chunk: list[tuple[str, float, float]] = []
    for k, (w, s, e) in enumerate(words):
        chunk.append((w, s, e))
        nxt = words[k + 1] if k + 1 < len(words) else None
        pause = nxt is not None and nxt[1] - e > 0.5
        if len(chunk) >= max_words or pause or w[-1:] in ".!?," or nxt is None:
            cues.append(Cue(text=" ".join(x[0] for x in chunk), start=round(chunk[0][1], 2),
                            end=round(e, 2)))
            chunk = []
    for c, nxt in zip(cues, cues[1:]):  # close small gaps so captions don't flicker
        if nxt.start - c.end < 0.3:
            c.end = nxt.start
    return cues


def render(p: VgProject, job: Job | None = None) -> dict:
    if not p.video:
        raise UserError("Add a video first (step 2).")
    src = media_dir(p.id) / p.video.file
    if not src.exists():
        raise UserError("The video file is missing. Upload it again.")
    start, end = window(p)
    dur = end - start
    if dur < 0.5:
        raise UserError("The trimmed video is too short. Check the start and end times.")
    s = p.settings

    video_id = videos.new_id()
    work = WORK_DIR / video_id
    work.mkdir(parents=True, exist_ok=True)
    try:
        if job:
            job.update(0.05, "Drawing text and captions…")
        overlays: list[tuple[Path, str, str, float, float]] = []  # png, x, y, from, to
        for i, t in enumerate(p.texts):
            a, b = max(t.start, 0.0), min(t.end, dur)
            img = text_image(t) if b - a > 0.05 else None
            if img:
                png = work / f"text_{i}.png"
                img.save(png)
                overlays.append((png, f"{round(t.x * W)}-w/2", f"{round(t.y * H)}-h/2", a, b))
        if s.captions:
            for i, c in enumerate(p.captions):
                a, b = max(c.start, 0.0), min(c.end, dur)
                img = caption_image(c.text, s.caption_size, s.caption_color) if b - a > 0.05 else None
                if img:
                    png = work / f"cap_{i}.png"
                    img.save(png)
                    overlays.append((png, "(W-w)/2", f"{round(s.caption_y * H)}-h/2", a, b))

        args = ["-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(src)]
        graph = [_frame(f"[0:v]fps={FPS},", s.fit, W, H, "[v0]")]
        last = "v0"
        for k, (png, x, y, a, b) in enumerate(overlays, start=1):
            args += ["-i", str(png)]
            graph.append(f"[{last}][{k}:v]overlay=x={x}:y={y}:"
                         f"enable='gte(t\\,{a:.3f})*lt(t\\,{b:.3f})'[v{k}]")
            last = f"v{k}"
        # JPEG-like full-range sources are converted so players show the right colours.
        graph.append(f"[{last}]scale=out_range=tv,format=yuv420p[v]")

        fmt = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo"
        n_in = len(overlays) + 1
        args += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
        graph.append(f"[{n_in}:a]aformat=sample_fmts=fltp:channel_layouts=stereo[base]")
        mix = ["[base]"]
        n_in += 1
        if s.video_sound and s.video_volume > 0 and probe(src).has_audio:
            graph.append(f"[0:a]{fmt},volume={s.video_volume:.3f}[va]")
            mix.append("[va]")
        audio = media_dir(p.id) / p.audio.file if p.audio else None
        if audio and audio.exists() and s.audio_volume > 0 and s.audio_start < dur:
            args += ["-i", str(audio)]
            graph.append(f"[{n_in}:a]{fmt},volume={s.audio_volume:.3f},"
                         f"atrim=0:{dur - max(s.audio_start, 0):.3f},"
                         f"adelay={round(max(s.audio_start, 0) * 1000)}:all=1[ea]")
            mix.append("[ea]")
            n_in += 1
        graph.append(f"{''.join(mix)}amix=inputs={len(mix)}:duration=first:normalize=0:"
                     f"dropout_transition=0,alimiter=limit=0.95[a]")

        if job:
            job.update(0.15, "Rendering the video…")
        mp4, jpg, _ = videos.paths(video_id)
        run_ffmpeg(args + ["-filter_complex", ";".join(graph), "-map", "[v]", "-map", "[a]",
                           "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                           "-profile:v", "high", "-pix_fmt", "yuv420p", "-color_range", "tv",
                           "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f"{dur:.3f}",
                           "-movflags", "+faststart", str(mp4)])
        if job:
            job.update(0.95, "Making the thumbnail…")
        make_thumbnail(mp4, jpg, at=min(1.0, dur / 2))
        duration = probe(mp4).duration
    finally:
        shutil.rmtree(work, ignore_errors=True)

    return videos.save_meta({
        "id": video_id, "tool": "videogen", "title": " ".join(p.title.split()) or "Untitled video",
        "project_id": p.id, "created_at": time.time(), "duration": round(duration, 2),
    })
