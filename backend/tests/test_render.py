"""End-to-end render test with generated clips (no internet needed).

Each clip is a solid, distinct colour so we can tell from a frame which clip is playing, and
clips with audio carry a sine tone so we can tell where sound should be.
"""
import re
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from app import downloader
from app.config import RANKING_DIR, WORK_DIR, ensure_dirs
from app.ffmpeg_util import ffmpeg_exe, probe, run_ffmpeg
from app.tools.ranking.models import (MediaFile, Project, RankSettings, Slot, playback_order,
                                      shuffled_order)
from app.tools.ranking.overlay import BAND_H, LIST_TOP, W, rank_metrics
from app.tools.ranking.render import render

# (rank, colour, size, has_audio, seconds)
CLIPS = [
    (1, (200, 30, 30), "1280x720", True, 4),     # landscape, audio
    (2, (30, 160, 40), "720x1280", False, 4),    # portrait, silent
    (3, (40, 60, 220), "1080x1080", True, 4),    # square, audio
    (4, (140, 40, 160), "640x480", False, 1.2),  # 4:3, silent, shorter than max seconds
]
MAX_SECONDS = 2.0
HIGHLIGHT = "#FFE14D"


def make_clip(path: Path, color, size, audio, seconds) -> None:
    hexcol = "0x%02x%02x%02x" % color
    args = ["-f", "lavfi", "-i", f"color=c={hexcol}:s={size}:r=25:d={seconds}"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=44100:duration={seconds}",
                 "-c:a", "aac"]
    args += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", str(path)]
    run_ffmpeg(args)


@pytest.fixture(scope="module")
def project() -> Project:
    ensure_dirs()
    slots = []
    for rank, color, size, audio, secs in CLIPS:
        src = WORK_DIR / f"sample_{rank}.mp4"
        make_clip(src, color, size, audio, secs)
        clip = downloader.register_upload(f"sample_{rank}.mp4", src)
        slots.append(Slot(caption=f"Caption {rank} wide text", clip=downloader.public_clip(clip)))
    slots[0].start, slots[0].end = 1.0, 3.5  # trim: 2.5s window, capped to 2s
    return Project(
        title="Ranking Best\nParkour Fails",
        highlights=[{"word": "parkour", "color": "#2DD4BF"}],
        slots=slots, custom_order=True, order=[3, 2, 4, 1],
        settings=RankSettings(max_seconds=MAX_SECONDS, highlight_color=HIGHLIGHT),
    )


def frame_at(video: Path, t: float) -> Image.Image:
    out = WORK_DIR / f"frame_{t:.2f}.png"
    run_ffmpeg(["-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1", str(out)])
    return Image.open(out).convert("RGB")


def mean_volume(video: Path, start: float, dur: float) -> float:
    proc = subprocess.run([ffmpeg_exe(), "-hide_banner", "-ss", f"{start}", "-t", f"{dur}",
                           "-i", str(video), "-af", "volumedetect", "-vn", "-f", "null", "-"],
                          capture_output=True, text=True)
    m = re.search(r"mean_volume:\s*(-?[\d.]+|-inf) dB", proc.stderr)
    return -999.0 if not m or m.group(1) == "-inf" else float(m.group(1))


def close(px, color, tol=45) -> bool:
    return all(abs(a - b) <= tol for a, b in zip(px, color))


def row_pixels(img: Image.Image, rank: int, n: int, x0: int, x1: int):
    spacing, _ = rank_metrics(n)
    y = int(LIST_TOP + (rank - 1) * spacing + spacing / 2)
    return [img.getpixel((x, yy)) for x in range(x0, x1, 2) for yy in range(y - 12, y + 12, 3)]


def is_yellow(p) -> bool:
    return p[0] > 200 and p[1] > 170 and p[2] < 140


def is_white(p) -> bool:
    return min(p) > 215


def test_playback_order_helpers():
    p = Project(slots=[Slot() for _ in range(5)])
    assert playback_order(p) == [5, 4, 3, 2, 1]
    p.custom_order, p.order = True, [2, 5, 3, 4, 1]
    assert playback_order(p) == [2, 5, 3, 4, 1]
    p.order = [1, 2]  # invalid -> falls back to countdown
    assert playback_order(p) == [5, 4, 3, 2, 1]
    for _ in range(20):
        o = shuffled_order(7)
        assert o[-1] == 1 and sorted(o) == list(range(1, 8))


def test_url_cache_key_ignores_tracking():
    a = downloader.cache_key("https://www.instagram.com/reel/ABC123/?igsh=xyz")
    b = downloader.cache_key("https://instagram.com/reel/ABC123")
    assert a == b
    assert downloader.cache_key("https://youtube.com/watch?v=1&t=3") == \
        downloader.cache_key("https://m.youtube.com/watch?v=1")


def test_friendly_errors():
    msg = downloader.friendly_error("ERROR: login required to view", "none", "instagram.com")
    assert "cookies" in msg.lower()
    assert "supported" in downloader.friendly_error("ERROR: Unsupported URL: x", "none")


def test_full_render(project: Project):
    video = render(project)
    mp4 = Path(downloader.DOWNLOADS_DIR).parent / "outputs" / f"{video['id']}.mp4"
    info = probe(mp4)
    stderr = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(mp4)],
                            capture_output=True, text=True).stderr
    assert "h264" in stderr and "aac" in stderr and "30 fps" in stderr
    assert (info.width, info.height) == (1080, 1920)
    assert info.has_audio

    expected = [(3, 2.0), (2, 2.0), (4, 1.2), (1, 2.0)]
    assert [t["rank"] for t in video["timeline"]] == [r for r, _ in expected]
    assert abs(info.duration - sum(d for _, d in expected)) < 0.15

    colors = {rank: color for rank, color, *_ in CLIPS}
    audio = {rank: a for rank, _, _, a, _ in CLIPS}
    played: list[int] = []
    for seg in video["timeline"]:
        rank = seg["rank"]
        played.append(rank)
        mid = (seg["start"] + seg["end"]) / 2
        img = frame_at(mp4, mid)

        # The right clip is on screen (sample the centre of the clip area, away from the list).
        assert close(img.getpixel((900, BAND_H + 750)), colors[rank]), f"wrong clip for rank {rank}"
        # Title band is black at its edges, title text is drawn in the middle.
        assert max(img.getpixel((5, 5))) < 30
        band = [img.getpixel((x, y)) for x in range(0, 1080, 6) for y in range(40, BAND_H - 40, 6)]
        assert any(is_white(p) for p in band)
        assert any(close(p, (45, 212, 191), 40) for p in band), "highlighted keyword missing"

        for r in range(1, 5):
            caption_area = row_pixels(img, r, 4, 260, 900)
            number_area = row_pixels(img, r, 4, 40, 140)
            if r == rank:
                assert any(is_yellow(p) for p in caption_area), f"rank {r} not highlighted"
            elif r in played:
                assert any(is_white(p) for p in caption_area), f"rank {r} caption should stay"
            else:
                assert not any(is_white(p) or is_yellow(p) for p in caption_area), \
                    f"rank {r} caption shown too early"
                assert any(max(p) > 200 for p in number_area), f"rank {r} number missing"

        vol = mean_volume(mp4, seg["start"] + 0.2, seg["end"] - seg["start"] - 0.4)
        if audio[rank]:
            assert vol > -35, f"rank {rank} should be audible, got {vol} dB"
        else:
            assert vol < -60, f"rank {rank} should be silent, got {vol} dB"


def test_render_reports_missing_clip():
    from app.jobs import UserError
    p = Project(slots=[Slot() for _ in range(3)])
    with pytest.raises(UserError, match="Rank 1 has no clip"):
        render(p)


def test_unavailable_error_is_friendly():
    msg = downloader.friendly_error("ERROR: [youtube] abc: This video is unavailable", "none", "youtube.com")
    assert msg.startswith("That video is unavailable")


def _output(video: dict) -> Path:
    return Path(downloader.DOWNLOADS_DIR).parent / "outputs" / f"{video['id']}.mp4"


def test_full_clip_length(project: Project):
    p = project.model_copy(deep=True)
    p.settings.clip_length = "full"
    video = render(p)
    # Rank 1 plays its whole 2.5s trim; the others play their full length.
    assert [(t["rank"], round(t["end"] - t["start"], 1)) for t in video["timeline"]] == \
        [(3, 4.0), (2, 4.0), (4, 1.2), (1, 2.5)]


def test_mute_and_external_audio(project: Project):
    p = project.model_copy(deep=True)
    p.slots[2].mute = True  # rank 3 has sound, but is muted
    timeline = render(p)
    mp4 = _output(timeline)
    seg3 = next(t for t in timeline["timeline"] if t["rank"] == 3)
    assert mean_volume(mp4, seg3["start"] + 0.3, 1.0) < -60

    track = RANKING_DIR / p.id / "audio_test.wav"
    track.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(["-f", "lavfi", "-i", "sine=frequency=660:duration=3", str(track)])  # loops
    p.external_audio = MediaFile(file=track.name, duration=3)
    p.settings.audio_mode = "external"
    video = render(p)
    mp4 = _output(video)
    for seg in video["timeline"]:  # sound everywhere, also over the silent clips 2 and 4
        assert mean_volume(mp4, seg["start"] + 0.2, min(0.6, seg["end"] - seg["start"] - 0.3)) > -40
    assert abs(probe(mp4).duration - timeline["duration"]) < 0.15


def test_crop_zoom_and_position(project: Project):
    src = WORK_DIR / "halves.mp4"
    run_ffmpeg(["-f", "lavfi", "-i", "color=c=0xc81e1e:s=1280x720:r=25:d=2",
                "-vf", "drawbox=x=640:y=0:w=640:h=720:color=0x1e1ec8:t=fill",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", str(src)])
    clip = downloader.public_clip(downloader.register_upload("halves.mp4", src))
    centre = (W // 2, BAND_H + (1920 - BAND_H) // 2)
    seen = {}
    for pan_x in (0.0, 1.0):
        p = project.model_copy(deep=True)
        p.settings.fit_mode = "fill"
        for s in p.slots:
            s.clip, s.start, s.end, s.zoom, s.pan_x = clip, None, None, 2.0, pan_x
        mp4 = _output(render(p))
        seen[pan_x] = frame_at(mp4, 0.5).getpixel(centre)
    assert close(seen[0.0], (200, 30, 30)) and close(seen[1.0], (30, 30, 200))
