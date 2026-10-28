"""Turn a ranking project into a 1080x1920 / 30fps / H.264+AAC Short.

Each clip becomes one normalized segment (scaled clip + overlay PNG + loudness-normalized audio,
or silence), then the segments are joined with the concat demuxer. Every segment shares the same
encoder settings, so the join copies video without re-encoding and has no gaps.
"""
import shutil
import time
from pathlib import Path

from ... import downloader, videos
from ...config import WORK_DIR
from ...ffmpeg_util import make_thumbnail, probe, run_ffmpeg
from ...jobs import Job, UserError
from .models import MIN_SLOTS, Project, playback_order
from .overlay import BAND_H, H, W, norm_word, render_overlay

FPS = 30
AREA_H = H - BAND_H
MIN_CLIP_SECONDS = 0.5


def plan_segments(p: Project, clips: dict[int, dict]) -> list[dict]:
    """Work out which part of each clip plays, in playback order."""
    segs = []
    for rank in playback_order(p):
        slot = p.slots[rank - 1]
        clip = clips[rank]
        dur_src = clip["duration"]
        start = min(max(slot.start or 0.0, 0.0), max(dur_src - MIN_CLIP_SECONDS, 0.0))
        end = slot.end if slot.end and slot.end > start else dur_src
        end = min(end, dur_src)
        length = min(end - start, p.settings.max_seconds)
        frames = max(1, round(length * FPS))
        if length < MIN_CLIP_SECONDS:
            raise UserError(f"Rank {rank}: the trimmed part is too short (under half a second). "
                            "Check its start/end times.")
        segs.append({"rank": rank, "clip": clip, "start": start, "frames": frames,
                     "duration": frames / FPS})
    return segs


def video_filter(fit_mode: str, duration: float) -> str:
    area = f"{W}:{AREA_H}"
    if fit_mode == "fill":
        clip = (f"[0:v]fps={FPS},setsar=1,scale={area}:force_original_aspect_ratio=increase,"
                f"crop={area}[vid];")
    else:
        clip = (f"[0:v]fps={FPS},setsar=1,split=2[a][b];"
                f"[a]scale={area}:force_original_aspect_ratio=increase,crop={area},"
                f"scale={W // 5}:{AREA_H // 5},boxblur=6:2,scale={area},eq=brightness=-0.15[bg];"
                f"[b]scale={area}:force_original_aspect_ratio=decrease:force_divisible_by=2[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2[vid];")
    return (clip +
            f"[vid]pad={W}:{H}:0:{BAND_H}:black,tpad=stop_mode=clone:stop_duration=3[base];"
            f"[base][1:v]overlay=0:0,format=yuv420p,trim=duration={duration:.4f},"
            f"setpts=PTS-STARTPTS[v]")


def render_segment(seg: dict, overlay_png: Path, fit_mode: str, out: Path) -> None:
    clip = seg["clip"]
    src = downloader.clip_file(clip)
    dur = seg["duration"]
    args = []
    if seg["start"] > 0:
        args += ["-ss", f"{seg['start']:.3f}"]
    args += ["-t", f"{dur + 1:.3f}", "-i", str(src), "-i", str(overlay_png)]
    if clip["has_audio"]:
        audio = ("[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                 "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,")
    else:
        args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        audio = "[2:a]"
    audio += f"apad,atrim=duration={dur:.4f},asetpts=PTS-STARTPTS[a]"
    args += [
        "-filter_complex", video_filter(fit_mode, dur) + ";" + audio,
        "-map", "[v]", "-map", "[a]",
        "-frames:v", str(seg["frames"]), "-r", str(FPS),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high",
        "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
        "-t", f"{dur:.4f}", str(out),
    ]
    run_ffmpeg(args)


def join_segments(segments: list[Path], out: Path) -> None:
    # Segments share a folder with the list, so bare names avoid Windows path quoting issues.
    listing = segments[0].parent / "segments.txt"
    listing.write_text("".join(f"file '{s.name}'\n" for s in segments))
    run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(listing),
                "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
                "-movflags", "+faststart", str(out)])


def ensure_clips(p: Project, job: Job | None) -> dict[int, dict]:
    n = len(p.slots)
    clips: dict[int, dict] = {}
    for i, slot in enumerate(p.slots):
        rank = i + 1
        clip = downloader.load_clip(slot.clip["clip_id"]) if slot.clip else None
        if not clip:
            if not slot.url.strip():
                raise UserError(f"Rank {rank} has no clip yet. Paste a link into it first.")
            if job:
                job.update(0.3 * i / n, f"Downloading clip {rank}/{n}…")
            clip = downloader.download(slot.url)
        clips[rank] = clip
    return clips


def render(p: Project, job: Job | None = None) -> dict:
    n = len(p.slots)
    if n < MIN_SLOTS:
        raise UserError(f"Add at least {MIN_SLOTS} clips.")
    clips = ensure_clips(p, job)
    segs = plan_segments(p, clips)

    highlights = {norm_word(h.word): h.color for h in p.highlights if norm_word(h.word)}
    captions = [s.caption for s in p.slots]
    s = p.settings
    video_id = videos.new_id()
    work = WORK_DIR / video_id
    work.mkdir(parents=True, exist_ok=True)
    try:
        revealed: set[int] = set()
        seg_files = []
        for i, seg in enumerate(segs):
            if job:
                job.update(0.3 + 0.6 * i / len(segs), f"Rendering clip {i + 1}/{len(segs)}…")
            revealed.add(seg["rank"])
            png = work / f"overlay_{i}.png"
            render_overlay(p.title, highlights, s.title_font_size, captions, set(revealed),
                           seg["rank"], s.highlight_color, s.medal_colors).save(png)
            out = work / f"seg_{i:02d}.mkv"
            render_segment(seg, png, s.fit_mode, out)
            seg_files.append(out)

        if job:
            job.update(0.92, "Joining clips…")
        mp4, jpg, _ = videos.paths(video_id)
        join_segments(seg_files, mp4)
        make_thumbnail(mp4, jpg, at=0.5)
        duration = probe(mp4).duration
    finally:
        shutil.rmtree(work, ignore_errors=True)

    plain_title = " ".join(p.title.split()) or "Untitled ranking"
    return videos.save_meta({
        "id": video_id, "tool": "ranking", "title": plain_title, "project_id": p.id,
        "created_at": time.time(), "duration": round(duration, 2),
        "order": [seg["rank"] for seg in segs],
        "timeline": _timeline(segs),
    })


def _timeline(segs: list[dict]) -> list[dict]:
    t, out = 0.0, []
    for seg in segs:
        out.append({"rank": seg["rank"], "start": round(t, 3), "end": round(t + seg["duration"], 3)})
        t += seg["duration"]
    return out
