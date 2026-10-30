"""Video Generator tests: trim + framing, mute / external audio mixing, text and captions,
and auto-captions (speech recognition stubbed so no model download is needed)."""
import subprocess
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from app.config import OUTPUTS_DIR, WORK_DIR, ensure_dirs
from app.ffmpeg_util import ffmpeg_exe, probe, run_ffmpeg
from app.tools.videogen.models import Cue, MediaFile, TextItem, VgProject
from app.tools.videogen.render import group_words, media_dir, render


def _video(p: VgProject, seconds: float = 4, sound: bool = True) -> None:
    out = media_dir(p.id) / "v.mp4"
    args = ["-f", "lavfi", "-i", f"color=c=0x2040d0:s=640x1136:r=25:d={seconds}"]
    if sound:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-c:a", "aac", "-shortest"]
    run_ffmpeg(args + ["-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)])
    p.video = MediaFile(file="v.mp4", duration=seconds, has_audio=sound)


def _audio(p: VgProject, seconds: float = 2) -> None:
    run_ffmpeg(["-f", "lavfi", "-i", f"sine=frequency=300:duration={seconds}", "-c:a", "libmp3lame",
                str(media_dir(p.id) / "a.mp3")])
    p.audio = MediaFile(file="a.mp3", duration=seconds)


def _frame(mp4: Path, t: float) -> Image.Image:
    png = WORK_DIR / f"{mp4.stem}_{t}.png"
    run_ffmpeg(["-ss", str(t), "-i", str(mp4), "-frames:v", "1", str(png)])
    return Image.open(png).convert("RGB")


def _max_volume(mp4: Path, start: float, end: float) -> float:
    err = subprocess.run([ffmpeg_exe(), "-hide_banner", "-ss", str(start), "-t", str(end - start),
                          "-i", str(mp4), "-af", "volumedetect", "-vn", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return float(err.split("max_volume:")[1].split("dB")[0])


def _out(result: dict) -> Path:
    return OUTPUTS_DIR / f"{result['id']}.mp4"


def test_trim_text_and_captions():
    ensure_dirs()
    p = VgProject(title="Edit")
    _video(p)
    p.settings.trim_start, p.settings.trim_end = 1.0, 3.5
    p.texts = [TextItem(text="HELLO", start=0, end=1, y=0.2, color="#FFD54A", box=True)]
    p.captions = [Cue(text="caption words", start=1.5, end=2.4)]
    mp4 = _out(render(p))
    info = probe(mp4)
    assert (info.width, info.height) == (1080, 1920) and abs(info.duration - 2.5) < 0.1
    stderr = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(mp4)], capture_output=True, text=True).stderr
    assert "h264" in stderr and "aac" in stderr and "30 fps" in stderr

    blue = lambda px: px[2] > 150 and px[0] < 100
    box = lambda px: px[0] > 70 and px[2] > 230  # #5669FF, lighter than the blue video
    early, late = _frame(mp4, 0.5), _frame(mp4, 2.0)
    row = [(x, round(0.2 * 1920) - 50) for x in range(300, 780, 4)]  # above the text, inside the box
    assert sum(box(early.getpixel(xy)) for xy in row) > 50  # text box drawn in its window
    assert sum(box(late.getpixel(xy)) for xy in row) == 0 and blue(late.getpixel((540, 384)))
    white = sum(1 for x in range(100, 980, 4) if min(late.getpixel((x, round(0.86 * 1920)))) > 225)
    assert white > 5  # caption on screen at 2.0s
    white_early = sum(1 for x in range(100, 980, 4) if min(early.getpixel((x, round(0.86 * 1920)))) > 225)
    assert white_early == 0


def test_mute_video_and_mix_external_audio():
    ensure_dirs()
    p = VgProject()
    _video(p)
    assert _max_volume(_out(render(p)), 0.2, 3.8) > -30  # video sound kept by default
    p.settings.video_sound = False
    assert _max_volume(_out(render(p)), 0, 4) < -80  # muted, but still has an audio track
    _audio(p, 2)
    p.settings.audio_start = 1.0
    mp4 = _out(render(p))
    assert abs(probe(mp4).duration - 4) < 0.1  # the video sets the length
    assert _max_volume(mp4, 0, 0.9) < -80 and _max_volume(mp4, 1.2, 2.8) > -30
    assert _max_volume(mp4, 3.2, 4) < -80  # external audio ended


def test_video_without_sound_renders():
    ensure_dirs()
    p = VgProject()
    _video(p, sound=False)
    assert probe(_out(render(p))).has_audio


def test_group_words_breaks_at_pauses_and_sentences():
    words = [("Hi", 0.0, 0.3), ("there.", 0.3, 0.6), ("This", 0.7, 0.9), ("is", 0.9, 1.0),
             ("a", 1.0, 1.1), ("test", 1.1, 1.4), ("later", 3.0, 3.4)]
    cues = group_words(words)
    assert [c.text for c in cues] == ["Hi there.", "This is a", "test", "later"]
    assert cues[0].end == cues[1].start  # small gap closed
    assert cues[2].end == 1.4  # long pause kept


def test_upload_and_auto_captions(monkeypatch):
    ensure_dirs()
    from app.main import app
    from app.tools.aivideo import sync

    c = TestClient(app)
    pid = c.post("/api/videogen/projects").json()["id"]
    src = WORK_DIR / "vg_upload.mp4"
    run_ffmpeg(["-f", "lavfi", "-i", "color=s=320x568:d=3", "-f", "lavfi", "-i", "sine=d=3",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(src)])
    video = c.post(f"/api/videogen/projects/{pid}/video",
                   files={"file": ("clip.mp4", src.read_bytes(), "video/mp4")}).json()
    assert video["has_audio"] and video["thumb"] and abs(video["duration"] - 3) < 0.1
    bad = c.post(f"/api/videogen/projects/{pid}/video", files={"file": ("x.mp3", b"abc", "audio/mpeg")})
    assert bad.status_code == 400

    heard = [("helo", 1.0, 1.3), ("world", 1.3, 1.7), ("again", 1.9, 2.3)]
    monkeypatch.setattr(sync, "transcribe", lambda path, job=None: heard)
    p = c.get(f"/api/videogen/projects/{pid}").json()
    p["video"] = video
    p["settings"]["trim_start"] = 1.0
    job = c.post(f"/api/videogen/projects/{pid}/auto-captions",
                 json={"project": p, "source": "video", "script": "Hello world again"}).json()
    import time
    for _ in range(50):
        job = c.get(f"/api/jobs/{job['id']}").json()
        if job["status"] in ("done", "error"):
            break
        time.sleep(0.1)
    assert job["status"] == "done", job
    cues = job["result"]["captions"]
    assert cues[0]["text"] == "Hello world again"  # the script's spelling
    assert cues[0]["start"] == 0.0  # shifted by the trim
    c.delete(f"/api/videogen/projects/{pid}")
