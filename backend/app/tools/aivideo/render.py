"""Turn an AI Video project into a 1080x1920 / 30fps / H.264+AAC Short with FFmpeg.

Each scene becomes one silent segment: footage (video cropped+looped, image with a Ken Burns
move, or an animated gradient), a PNG with the title banner + ranking list, the scene label
sliding in, timed caption PNGs and a short white flash. Segments are joined without
re-encoding, then the voiceover (master track), music and whooshes are mixed on top.
"""
import shutil
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ... import videos
from ...config import WORK_DIR
from ...ffmpeg_util import make_thumbnail, probe, run_ffmpeg
from ...jobs import Job, UserError
from ...textdraw import plain
from . import footage as ft
from .models import AiProject, Footage, Scene
from .overlay import AREA_H, BANNER_H, CAPTION_CY, H, LABEL_CY, W, base_overlay, caption_image, label_image
from .script import caption_chunks, is_blank, parse_rank, parse_table, resolve_timings

FPS = 30
FLASH = 0.24


def usable(project_id: str, f: Footage | None) -> bool:
    if not f:
        return False
    if f.kind == "gradient":
        return True
    return bool(f.file) and (ft.project_dir(project_id) / f.file).exists()


def fill_footage(p: AiProject, indexes: list[int], job: Job | None, lo: float, hi: float,
                 results: dict | None = None) -> dict[str, Footage]:
    """Build footage for the given scenes in parallel; updates p.scenes in place."""
    done: dict[str, Footage] = results if results is not None else {}
    if not indexes:
        return done
    mode = p.settings.footage_source

    def one(i: int) -> None:
        scene = p.scenes[i]
        old = scene.footage
        def waiting(seconds: int) -> None:
            if job:
                job.update(step=f"Free AI image limit: waiting {seconds}s before the next image "
                                f"({len(done)}/{len(indexes)} done)…")

        new = ft.build(p.id, scene, i, mode, waiting)
        if old and old != new and old.file != new.file:
            ft.remove_footage(p.id, old)
        scene.footage = new
        done[scene.id] = new.model_dump()
        if job:
            job.update(lo + (hi - lo) * len(done) / len(indexes),
                       f"Generating footage {len(done)}/{len(indexes)}…")

    if job:
        job.update(lo, f"Generating footage 0/{len(indexes)}…")
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(one, indexes))
    return done


def area_height(fit: str) -> int:
    """Height of the footage area: below the title banner, or the whole frame for full screen."""
    return H if fit == "fullscreen" else AREA_H


def _footage_input(f: Footage, path: Path | None, index: int, dur: float, area_h: int) -> list[str]:
    t = f"{dur + 0.5:.3f}"
    if f.kind == "video":
        return ["-stream_loop", "-1", "-t", t, "-i", str(path)]
    if f.kind == "image":
        return ["-loop", "1", "-framerate", str(FPS), "-t", t, "-i", str(path)]
    c0, c1 = ft.GRADIENTS[index % len(ft.GRADIENTS)]
    src = (f"gradients=s={W}x{area_h}:c0=0x{c0[1:]}:c1=0x{c1[1:]}:speed=0.02:r={FPS}"
           f":seed={index + 1}")
    return ["-f", "lavfi", "-t", t, "-i", src]


AUTO_MOTIONS = ["zoom_in", "zoom_out", "pan_right"]  # "auto" cycles through these per scene


def image_motion(motion: str, index: int) -> str:
    return AUTO_MOTIONS[index % len(AUTO_MOTIONS)] if motion == "auto" else motion


def _frame(src: str, fit: str, w: int, h: int, out: str) -> str:
    """Fit the picture into a w x h box: crop to fill, or show it whole over blur / black."""
    if fit == "fit_blur":
        return (f"{src}split=2[fa][fb];"
                f"[fa]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},"
                f"scale={w // 8}:{h // 8},boxblur=4:2,scale={w}:{h},eq=brightness=-0.15[bg];"
                f"[fb]scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2[fit];"
                f"[bg][fit]overlay=(W-w)/2:(H-h)/2,setsar=1{out}")
    if fit == "fit_black":
        return (f"{src}scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2,"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1{out}")
    return f"{src}scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1{out}"


def _footage_filter(f: Footage, index: int, frames: int, motion: str = "auto",
                    fit: str = "fill") -> str:
    area_h = area_height(fit)
    if f.kind == "video":
        return _frame(f"[0:v]fps={FPS},", fit, W, area_h, "[fg]")
    if f.kind == "image":
        motion = image_motion(motion, index)
        if motion == "still":
            return _frame(f"[0:v]fps={FPS},", fit, W, area_h, "[fg]")
        bw, bh = W * 3 // 2, area_h * 3 // 2  # oversample so the slow movement stays smooth
        p = f"on/{max(frames - 1, 1)}"  # 0 → 1 across the scene
        cx, cy = "x='iw/2-(iw/zoom/2)'", "y='ih/2-(ih/zoom/2)'"
        move = {
            "zoom_in": f"z='1+0.15*{p}':{cx}:{cy}",
            "zoom_out": f"z='1.15-0.15*{p}':{cx}:{cy}",
            "pan_right": f"z='1.15':x='(iw-iw/zoom)*{p}':{cy}",
            "pan_left": f"z='1.15':x='(iw-iw/zoom)*(1-{p})':{cy}",
            "pan_down": f"z='1.15':{cx}:y='(ih-ih/zoom)*{p}'",
            "pan_up": f"z='1.15':{cx}:y='(ih-ih/zoom)*(1-{p})'",
        }[motion]
        return (_frame("[0:v]", fit, bw, bh, "[framed]") + ";"
                f"[framed]zoompan={move}:d=1:s={W}x{area_h}:fps={FPS},setsar=1[fg]")
    return "[0:v]format=yuv420p,setsar=1[fg]"


def render_segment(p: AiProject, index: int, frames: int, base_png: Path,
                   label: tuple[Path, float, float] | None, captions: list[tuple[Path, float, float]],
                   out: Path) -> None:
    scene = p.scenes[index]
    f = scene.footage
    dur = frames / FPS
    path = ft.project_dir(p.id) / f.file if f.file else None
    area_h = area_height(scene.fit)
    args = _footage_input(f, path, index, dur, area_h) + ["-i", str(base_png)]
    graph = [_footage_filter(f, index, frames, scene.motion, scene.fit),
             f"[fg]pad={W}:{H}:0:{H - area_h}:black[s0]", "[s0][1:v]overlay=0:0[s1]"]
    last, n_in = "s1", 2
    if label:
        from PIL import Image
        label_png, la, lb = label
        lw, lh = Image.open(label_png).size
        lx, ly = (W - lw) // 2, LABEL_CY - lh // 2
        args += ["-i", str(label_png)]
        # ease-out slide in from the right, starting 0.15s after the label's show time
        slide = f"pow(1-min(max(t-{la + 0.15:.3f}\\,0)/0.45\\,1)\\,3)"
        graph.append(f"[{last}][{n_in}:v]overlay=x='{lx}+({W}-{lx})*{slide}':y={ly}:"
                     f"enable='gte(t\\,{la:.3f})*lt(t\\,{lb:.3f})'[s{n_in}]")
        last, n_in = f"s{n_in}", n_in + 1
    for png, a, b in captions:
        args += ["-i", str(png)]
        graph.append(f"[{last}][{n_in}:v]overlay=x=(W-w)/2:y={CAPTION_CY}-h/2:"
                     f"enable='gte(t\\,{a:.3f})*lt(t\\,{b:.3f})'[s{n_in}]")
        last, n_in = f"s{n_in}", n_in + 1
    if index > 0:  # quick white flash on scene change
        graph.append(f"color=c=white:s={W}x{H}:r={FPS}:d={FLASH},format=rgba,"
                     f"colorchannelmixer=aa=0.7,fade=t=out:st=0:d={FLASH}:alpha=1[fl]")
        graph.append(f"[{last}][fl]overlay=0:0:eof_action=pass[sf]")
        last = "sf"
    # JPEG footage is full-range; convert so every segment matches before they're joined.
    graph.append(f"[{last}]scale=out_range=tv,format=yuv420p[v]")
    args += ["-filter_complex", ";".join(graph), "-map", "[v]", "-frames:v", str(frames),
             "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
             "-profile:v", "high", "-pix_fmt", "yuv420p", "-color_range", "tv", "-an", str(out)]
    run_ffmpeg(args)


def mix_audio(p: AiProject, video: Path, voice: Path, total: float, boundaries: list[float],
              work: Path, out: Path) -> None:
    s = p.settings
    norm = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo," \
           "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000"
    args = ["-i", str(video), "-i", str(voice)]
    graph = [f"[1:a]{norm}[vo]"]
    mix = ["[vo]"]
    n_in = 2
    music = ft.project_dir(p.id) / p.music.file if p.music else None
    if music and music.exists() and s.music_volume > 0:
        args += ["-stream_loop", "-1", "-i", str(music)]
        graph.append(f"[{n_in}:a]{norm},volume={s.music_volume:.3f},atrim=0:{total:.3f},"
                     f"afade=t=out:st={max(total - 1.5, 0):.3f}:d=1.5[mu]")
        mix.append("[mu]")
        n_in += 1
    if s.whoosh and boundaries:
        whoosh = work / "whoosh.wav"
        run_ffmpeg(["-f", "lavfi", "-i", "anoisesrc=d=0.55:c=pink:r=48000:a=0.5",
                    "-af", "highpass=f=400,lowpass=f=6000,afade=t=in:d=0.3:curve=exp,"
                    "afade=t=out:st=0.3:d=0.25,volume=0.7,aformat=channel_layouts=stereo",
                    str(whoosh)])
        args += ["-i", str(whoosh)]
        k = len(boundaries)
        labels = [f"[w{i}]" for i in range(k)]
        graph.append(f"[{n_in}:a]asplit={k}{''.join(labels)}" if k > 1 else f"[{n_in}:a]anull[w0]")
        for i, b in enumerate(boundaries):
            ms = max(0, round((b - 0.3) * 1000))
            graph.append(f"[w{i}]adelay={ms}:all=1[wd{i}]")
            mix.append(f"[wd{i}]")
    if len(mix) > 1:
        graph.append(f"{''.join(mix)}amix=inputs={len(mix)}:duration=first:normalize=0:"
                     f"dropout_transition=0,alimiter=limit=0.95[a]")
    else:
        graph.append("[vo]alimiter=limit=0.95[a]")
    args += ["-filter_complex", ";".join(graph), "-map", "0:v", "-map", "[a]",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
             "-t", f"{total:.3f}", "-movflags", "+faststart", str(out)]
    run_ffmpeg(args)


def label_window(scene: Scene, a: float, b: float) -> tuple[float, float]:
    """When the scene's label is on screen, in video seconds (the whole scene unless set)."""
    start = a if scene.label_start is None else min(max(scene.label_start, a), b)
    end = b if scene.label_end is None else min(max(scene.label_end, start), b)
    return start, end


def scene_cues(scene: Scene, a: float, b: float) -> list[tuple[str, float, float]]:
    """Captions for a scene as (text, start, end) in video seconds, clipped to the scene."""
    if not scene.show_captions:
        return []
    if scene.captions is not None:  # manual list (may be empty = all captions deleted)
        cues = [(c.text, max(c.start, a), min(c.end, b)) for c in scene.captions]
        return [c for c in cues if c[0].strip() and c[2] - c[1] > 0.05]
    chunks = caption_chunks(scene.voiceover)
    d = (b - a) / max(len(chunks), 1)
    return [(t, a + d * j, a + d * (j + 1)) for j, t in enumerate(chunks)]


def render(p: AiProject, job: Job | None = None) -> dict:
    if not p.voiceover:
        raise UserError("Upload a voiceover first (step 2).")
    voice = ft.project_dir(p.id) / p.voiceover.file
    if not voice.exists():
        raise UserError("The voiceover file is missing. Upload it again.")
    if all(is_blank(s) for s in p.scenes) and p.script_text.strip():
        p.scenes = parse_table(p.script_text)  # script pasted but never turned into scenes
    if not p.scenes or all(is_blank(s) for s in p.scenes):
        raise UserError("The scenes are empty. Paste your script in step 3 and click \"Parse into scenes\" "
                        "(it needs Time, Voiceover and On screen columns).")
    total = probe(voice).duration
    if total < 1:
        raise UserError("The voiceover is too short.")
    timings = resolve_timings(p.scenes, total)

    missing = [i for i, s in enumerate(p.scenes) if not usable(p.id, s.footage)]
    generated = fill_footage(p, missing, job, 0.0, 0.3)

    total_frames = round(total * FPS)
    starts = [round(a * FPS) for a, _ in timings] + [total_frames]
    for i in range(1, len(starts)):  # every scene gets at least one frame
        starts[i] = max(starts[i], starts[i - 1] + 1)
    if starts[-2] >= total_frames:
        raise UserError("Too many scenes for the length of the voiceover.")
    ranks = {}
    for s in p.scenes:
        if s.rank:
            ranks[s.rank] = plain(s.rank_name or parse_rank(s.voiceover)[1])

    video_id = videos.new_id()
    work = WORK_DIR / video_id
    work.mkdir(parents=True, exist_ok=True)
    try:
        revealed: set[int] = set()
        segs = []
        n = len(p.scenes)
        for i, scene in enumerate(p.scenes):
            if job:
                job.update(0.3 + 0.55 * i / n, f"Rendering scene {i + 1}/{n}…")
            frames = starts[i + 1] - starts[i]
            dur = frames / FPS
            if scene.rank:
                revealed.add(scene.rank)
            base = work / f"base_{i}.png"
            base_overlay(p.title, ranks, set(revealed), scene.rank,
                         p.settings.ranking and scene.show_ranks,
                         show_banner=scene.fit != "fullscreen", title_color=p.title_color,
                         title_highlights=p.title_highlights).save(base)
            label = None
            seg_start = starts[i] / FPS
            la, lb = label_window(scene, seg_start, seg_start + dur)
            label_img = label_image(scene.label) if p.settings.labels and scene.show_label and lb - la > 0.05 else None
            if label_img:
                label_png = work / f"label_{i}.png"
                label_img.save(label_png)
                label = (label_png, la - seg_start, lb - seg_start)
            caps = []
            if p.settings.captions:
                for j, (text, a, b) in enumerate(scene_cues(scene, seg_start, seg_start + dur)):
                    img = caption_image(text)
                    if img:
                        png = work / f"cap_{i}_{j}.png"
                        img.save(png)
                        caps.append((png, a - seg_start, b - seg_start))
            out = work / f"seg_{i:02d}.mkv"
            render_segment(p, i, frames, base, label, caps, out)
            segs.append(out)

        if job:
            job.update(0.87, "Joining scenes…")
        listing = work / "segments.txt"
        listing.write_text("".join(f"file '{s.name}'\n" for s in segs))
        joined = work / "joined.mp4"
        run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(joined)])

        if job:
            job.update(0.92, "Mixing voiceover and music…")
        mp4, jpg, _ = videos.paths(video_id)
        boundaries = [st / FPS for st in starts[1:-1]]
        mix_audio(p, joined, voice, total, boundaries, work, mp4)
        make_thumbnail(mp4, jpg, at=min(timings[1][0] + 1.0, total / 2) if len(timings) > 1 else 0.5)
        duration = probe(mp4).duration
    finally:
        shutil.rmtree(work, ignore_errors=True)

    meta = videos.save_meta({
        "id": video_id, "tool": "aivideo", "title": " ".join(p.title.split()) or "Untitled video",
        "project_id": p.id, "created_at": time.time(), "duration": round(duration, 2),
        "timeline": [{"scene": i, "start": round(starts[i] / FPS, 3), "end": round(starts[i + 1] / FPS, 3)}
                     for i in range(len(p.scenes))],
    })
    return {**meta, "scene_footage": generated}
