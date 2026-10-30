"""AI Video Generator tests: script parsing, timing, captions and a full offline render
(uploaded image + uploaded looping video + gradient fallback, no internet needed)."""
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from app.config import WORK_DIR, ensure_dirs
from app.ffmpeg_util import ffmpeg_exe, probe, run_ffmpeg
from app.tools.aivideo import footage as ft
from app.tools.aivideo.models import AiProject, MediaFile, Scene
from app.tools.aivideo.overlay import BANNER_H, CAPTION_CY, LABEL_CY, LIST_TOP, ROW_H
from app.tools.aivideo.render import render
from app.tools.aivideo.script import caption_chunks, parse_table, resolve_timings

SAMPLE = (Path(__file__).parent / "sample_script.md").read_text()


def test_parse_sample_script():
    scenes = parse_table(SAMPLE)
    assert len(scenes) == 7
    assert (scenes[1].start, scenes[1].end) == (3, 11)
    assert scenes[0].label == "#1 = smaller than a golf course 🤯"
    assert scenes[0].prompt == "Spinning globe zooming in"
    assert (scenes[1].rank, scenes[1].rank_name, scenes[1].label) == (5, "San Marino", "61 km²")
    assert scenes[1].prompt == "Hilltop castle in the clouds"
    assert scenes[2].label == "" and scenes[2].prompt.startswith("Thin island strip")
    assert scenes[3].label == "⏱️ 20 min" and scenes[3].prompt == "Round island from above, car icon circling"
    assert [s.rank for s in scenes] == [None, 5, 4, 3, 2, 1, None]
    assert scenes[5].rank_name == "Vatican City"


def test_timings_use_script_or_word_counts():
    scenes = parse_table(SAMPLE)
    t = resolve_timings(scenes, 49.0)
    assert t[0] == (0, 3) and t[-1] == (45, 49.0)
    # Audio much shorter than the script: times are scaled to fit.
    t = resolve_timings(scenes, 24.5)
    assert t[-1][1] == 24.5 and abs(t[1][0] - 1.5) < 1e-6
    # No times: split by voiceover word count.
    loose = [Scene(voiceover="one two three"), Scene(voiceover="one")]
    assert resolve_timings(loose, 8.0) == [(0.0, 6.0), (6.0, 8.0)]


def test_caption_chunks_are_2_to_4_words():
    for n in range(2, 30):
        chunks = caption_chunks(" ".join(f"w{i}" for i in range(n)))
        assert sum(len(c.split()) for c in chunks) == n
        assert all(2 <= len(c.split()) <= 4 for c in chunks)


def frame_at(video: Path, t: float) -> Image.Image:
    out = WORK_DIR / f"ai_frame_{t:.2f}.png"
    run_ffmpeg(["-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1", str(out)])
    return Image.open(out).convert("RGB")


def count(img: Image.Image, box, pred) -> int:
    x0, y0, x1, y1 = box
    return sum(1 for x in range(x0, x1, 3) for y in range(y0, y1, 3) if pred(img.getpixel((x, y))))


def test_full_render_offline():
    ensure_dirs()
    p = AiProject(title="Smallest Countries In The World")
    d = ft.project_dir(p.id)
    run_ffmpeg(["-f", "lavfi", "-i", "sine=frequency=300:duration=10", "-c:a", "libmp3lame", str(d / "vo.mp3")])
    p.voiceover = MediaFile(file="vo.mp3", duration=10)

    img_src = WORK_DIR / "castle.png"
    Image.new("RGB", (800, 600), (30, 140, 60)).save(img_src)
    vid_src = WORK_DIR / "flags.mp4"
    run_ffmpeg(["-f", "lavfi", "-i", "color=c=0x903030:s=640x360:r=25:d=1.5", "-c:v", "libx264",
                "-pix_fmt", "yuv420p", str(vid_src)])
    image = ft.save_upload(p.id, "castle.png", img_src)
    video = ft.save_upload(p.id, "flags.mp4", vid_src)

    p.scenes = [
        Scene(start=0, end=3, voiceover="Ranking the smallest countries", label="Tiny 🤯", prompt="globe"),
        Scene(start=3, end=6, voiceover="#2 Monaco: two square kilometers", label="2 km²", rank=2,
              rank_name="Monaco", upload=image),
        Scene(start=6, end=10, voiceover="#1 Vatican City is the smallest", rank=1, rank_name="Vatican City",
              upload=video),
    ]
    p.settings.footage_source = "uploads"
    result = render(p)

    mp4 = Path(ft.AIVIDEO_DIR).parent / "outputs" / f"{result['id']}.mp4"
    info = probe(mp4)
    assert (info.width, info.height) == (1080, 1920) and info.has_audio
    assert abs(info.duration - probe(d / "vo.mp3").duration) < 0.1  # voiceover is the master track
    stderr = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(mp4)], capture_output=True, text=True).stderr
    assert "h264" in stderr and "aac" in stderr and "30 fps" in stderr
    assert "yuvj420p" not in stderr and "(pc" not in stderr  # limited range even with JPEG footage
    assert sorted(s["source"] for s in result["scene_footage"].values()) == ["gradient", "upload", "upload"]

    gold = lambda px: px[0] > 220 and 170 < px[1] < 225 and px[2] < 110
    white = lambda px: min(px) > 225
    accent = lambda px: px[2] > 200 and px[0] < 130 and px[1] < 140
    row1 = (250, LIST_TOP + 8, 420, LIST_TOP + ROW_H - 8)  # behind the #1 name: gold pill once revealed

    intro, monaco, vatican = frame_at(mp4, 1.5), frame_at(mp4, 4.8), frame_at(mp4, 8.5)
    assert max(intro.getpixel((5, 5))) < 30 and count(intro, (0, 0, 1080, BANNER_H - 12), white) > 50
    assert count(intro, (100, LABEL_CY - 60, 980, LABEL_CY + 60), accent) > 50  # label box
    assert count(intro, (40, CAPTION_CY - 30, 1040, CAPTION_CY + 30), white) > 30  # caption
    assert count(intro, row1, gold) == 0  # #1 not revealed yet
    # The uploaded image (green) fills the footage area during scene 2, video (red) in scene 3.
    assert monaco.getpixel((1000, 1400))[1] > 100 and vatican.getpixel((1000, 1400))[0] > 110
    assert count(vatican, row1, gold) > 50  # #1 revealed in gold

    vol = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(mp4), "-af", "volumedetect", "-vn",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    assert "mean_volume" in vol and "-inf" not in vol.split("mean_volume")[1][:20]


def test_render_needs_voiceover():
    from app.jobs import UserError
    with pytest.raises(UserError, match="voiceover"):
        render(AiProject(scenes=[Scene(voiceover="hi")]))


def test_parse_tab_separated_table_from_a_doc():
    text = SAMPLE.replace("|---|---|---|\n", "")
    text = "\n".join("\t".join(c.strip() for c in l.strip().strip("|").split("|")) for l in text.splitlines())
    text = text.replace("Ranking the smallest", "“Ranking the smallest").replace("golf course!", "golf course!”")
    scenes = parse_table(text)
    assert len(scenes) == 7 and scenes[1].rank == 5 and scenes[1].label == "61 km²"
    assert scenes[0].voiceover.startswith("Ranking the smallest")  # curly quotes removed


def test_render_refuses_empty_scenes():
    from app.jobs import UserError
    p = AiProject(scenes=[Scene()])
    p.voiceover = MediaFile(file="vo.mp3", duration=10)
    d = ft.project_dir(p.id)
    run_ffmpeg(["-f", "lavfi", "-i", "sine=duration=2", str(d / "vo.mp3")])
    with pytest.raises(UserError, match="Parse into scenes"):
        render(p)


def test_pixabay_prefers_vertical_clip(monkeypatch, tmp_path):
    import json
    calls = []
    hits = {"hits": [
        {"videos": {"large": {"url": "L4k", "width": 3840, "height": 2160},
                    "medium": {"url": "Lmed", "width": 1920, "height": 1080}}},
        {"videos": {"large": {"url": "", "width": 0, "height": 0},
                    "medium": {"url": "Vmed", "width": 1080, "height": 1920},
                    "small": {"url": "Vsmall", "width": 720, "height": 1280}}},
    ]}

    def fake_http(url, headers=None, timeout=60):
        calls.append(url)
        return json.dumps(hits).encode() if "api/videos" in url else b"video-bytes"

    monkeypatch.setattr(ft, "_http", fake_http)
    monkeypatch.setenv("PIXABAY_API_KEY", "k")
    monkeypatch.delenv("PEXELS_API_KEY", raising=False)
    path, kind = ft.stock("Packed skyline full of yachts 👥", tmp_path / "s")
    assert kind == "video" and path.read_bytes() == b"video-bytes"
    assert "q=packed%20skyline%20full%20yachts" in calls[0]
    assert calls[1] == "Vmed"  # vertical clip, largest size not above 1080p


def test_stock_without_keys_explains_why(monkeypatch, tmp_path):
    monkeypatch.delenv("PIXABAY_API_KEY", raising=False)
    monkeypatch.delenv("PEXELS_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="PIXABAY_API_KEY"):
        ft.stock("castle", tmp_path / "s")


def test_align_handles_spoken_numbers_and_gaps():
    from app.tools.aivideo.sync import align, sync_scenes
    script = "#5 San Marino: 61 km², founded".split()
    heard = [("Number", 3.0, 3.1), ("five", 3.1, 3.4), ("San", 3.5, 3.7), ("Marino,", 3.7, 4.1),
             ("61", 4.4, 4.8), ("square", 4.8, 5.3), ("kilometers,", 5.3, 5.7), ("founded", 6.0, 6.5)]
    t = align(script, heard, 10.0)
    assert t[0] == (3.1, 3.4)  # "#5" matched "five"
    assert t[1][0] == 3.5 and t[3][0] == 4.4
    assert 4.8 <= t[4][0] < t[4][1] <= 6.0  # "km²" interpolated between neighbours
    scenes = [Scene(voiceover="Intro words here"), Scene(voiceover=" ".join(script))]
    heard = [("Intro", 0.2, 0.5), ("words", 0.5, 0.8), ("here", 0.8, 1.0)] + heard
    out, unmatched = sync_scenes(scenes, heard, 10.0)
    assert out[0].start == 0 and abs(out[1].start - 3.0) < 0.01 and out[1].end == 10.0
    assert out[1].captions[0].text == "#5 San Marino:" and abs(out[1].captions[0].start - 3.1) < 0.01
    assert unmatched == []


def _words(text: str, start: float, step: float = 0.4) -> list[tuple[str, float, float]]:
    return [(w, start + k * step, start + k * step + 0.3) for k, w in enumerate(text.split())]


def test_sync_captions_follow_the_voice_when_it_differs_from_the_script():
    from app.tools.aivideo.sync import sync_scenes
    scenes = [Scene(voiceover="I've never told anyone this story before tonight."),
              Scene(voiceover="When I was fifteen we went to our ancestral home in India."),
              Scene(voiceover="Dadi was at the market that day.")]
    # Scene 1's line is never said; scene 2 is said with different words in the middle;
    # "Dadi" is misheard as "Daddy".
    heard = (_words("When I was 15, my friend greeted my grandmother in our kitchen.", 0.5)
             + _words("We were at our ancestral home in India.", 6.0)
             + _words("Daddy was at the market that day.", 10.0))
    out, unmatched = sync_scenes(scenes, heard, 14.0)
    assert unmatched == [0]
    assert out[0].captions == []  # nothing of scene 1 is spoken: no captions for it
    text = " ".join(c.text for c in out[1].captions)
    assert "my friend greeted my grandmother in our kitchen." in text  # what was actually said
    assert text.startswith("When I was fifteen") and "ancestral home in India." in text
    assert out[2].captions[0].text.startswith("Dadi was")  # script spelling for a misheard word
    assert abs(out[2].start - 9.9) < 0.01
    for s in out[1:]:  # every caption sits on its spoken words
        for c in s.captions:
            assert any(abs(c.start - w[1]) < 0.01 for w in heard)


def test_sync_captions_hide_during_long_pauses():
    from app.tools.aivideo.sync import sync_scenes
    heard = _words("one two three", 0.0) + _words("four five six", 5.0)
    out, _ = sync_scenes([Scene(voiceover="one two three four five six")], heard, 8.0)
    a, b = out[0].captions
    assert (a.start, b.start) == (0.0, 5.0) and a.end == round(0.8 + 0.3 + 0.3, 2) and b.end < 8.0


def test_manual_captions_are_used_and_clipped():
    from app.tools.aivideo.models import Cue
    from app.tools.aivideo.render import scene_cues
    s = Scene(voiceover="one two three four five six",
              captions=[Cue(text="early", start=1.0, end=2.5), Cue(text="late", start=4.5, end=9.0)])
    assert scene_cues(s, 2.0, 6.0) == [("early", 2.0, 2.5), ("late", 4.5, 6.0)]
    s.captions = None
    assert [c[0] for c in scene_cues(s, 0, 4)] == ["one two three", "four five six"]


def test_label_window_defaults_and_clipping():
    from app.tools.aivideo.render import label_window
    s = Scene(label="61 km²")
    assert label_window(s, 3.0, 11.0) == (3.0, 11.0)  # whole scene by default
    s.label_start, s.label_end = 5.0, 7.5
    assert label_window(s, 3.0, 11.0) == (5.0, 7.5)
    s.label_start, s.label_end = 1.0, 20.0
    assert label_window(s, 3.0, 11.0) == (3.0, 11.0)  # clipped to the scene


def test_label_only_shows_in_its_time_window():
    ensure_dirs()
    p = AiProject(title="Label timing")
    d = ft.project_dir(p.id)
    run_ffmpeg(["-f", "lavfi", "-i", "sine=frequency=300:duration=4", "-c:a", "libmp3lame", str(d / "vo.mp3")])
    p.voiceover = MediaFile(file="vo.mp3", duration=4)
    p.scenes = [Scene(voiceover="hello there", label="BIG LABEL", label_start=2.0, label_end=3.0)]
    p.settings.footage_source = "uploads"
    p.settings.captions = p.settings.ranking = p.settings.whoosh = False
    mp4 = Path(ft.AIVIDEO_DIR).parent / "outputs" / f"{render(p)['id']}.mp4"
    white = lambda px: min(px) > 235
    box = (100, LABEL_CY - 60, 980, LABEL_CY + 60)
    shown = lambda t: count(frame_at(mp4, t), box, white) > 20  # white label text/border
    assert not shown(1.0)
    assert shown(2.8)  # fully slid in by now
    assert not shown(3.5)


def _marker(img: Image.Image) -> tuple[float, float, int]:
    """Centre and size of the dark marker inside the footage area."""
    pts = [(x, y) for x in range(0, 1080, 4) for y in range(BANNER_H + 20, 1900, 4) if max(img.getpixel((x, y))) < 60]
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts), len(pts)


@pytest.mark.parametrize("motion", ["still", "zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "pan_down"])
def test_image_motion(motion):
    ensure_dirs()
    p = AiProject()
    d = ft.project_dir(p.id)
    run_ffmpeg(["-f", "lavfi", "-i", "sine=duration=2", "-c:a", "libmp3lame", str(d / "vo.mp3")])
    p.voiceover = MediaFile(file="vo.mp3", duration=2)
    src = WORK_DIR / f"marker_{motion}.png"
    im = Image.new("RGB", (900, 1400), (230, 230, 230))
    im.paste((0, 0, 0), (390, 640, 510, 760))  # dark square in the middle
    im.save(src)
    p.scenes = [Scene(voiceover="hi", upload=ft.save_upload(p.id, "m.png", src), motion=motion)]
    p.settings.footage_source = "uploads"
    p.settings.captions = p.settings.ranking = p.settings.whoosh = False
    mp4 = Path(ft.AIVIDEO_DIR).parent / "outputs" / f"{render(p)['id']}.mp4"
    (x0, y0, n0), (x1, y1, n1) = _marker(frame_at(mp4, 0.0)), _marker(frame_at(mp4, 1.9))
    dx, dy, grow = x1 - x0, y1 - y0, n1 / n0
    if motion == "still":
        assert abs(dx) < 3 and abs(dy) < 3 and abs(grow - 1) < 0.05
    elif motion == "zoom_in":
        assert grow > 1.15
    elif motion == "zoom_out":
        assert grow < 0.87
    elif motion == "pan_right":  # camera moves right, so the picture slides left
        assert dx < -40 and abs(dy) < 10
    elif motion == "pan_left":
        assert dx > 40 and abs(dy) < 10
    elif motion == "pan_down":
        assert dy < -40 and abs(dx) < 10
    elif motion == "pan_up":
        assert dy > 40 and abs(dx) < 10


def test_captions_can_be_hidden_per_scene():
    from app.tools.aivideo.render import scene_cues
    s = Scene(voiceover="one two three four five six")
    assert scene_cues(s, 0, 4)
    s.show_captions = False
    assert scene_cues(s, 0, 4) == []
    s.show_captions, s.captions = True, []  # every caption deleted by hand: stays empty
    assert scene_cues(s, 0, 4) == []


def test_last_scene_without_captions_renders_clean():
    ensure_dirs()
    p = AiProject()
    d = ft.project_dir(p.id)
    run_ffmpeg(["-f", "lavfi", "-i", "sine=duration=4", "-c:a", "libmp3lame", str(d / "vo.mp3")])
    p.voiceover = MediaFile(file="vo.mp3", duration=4)
    p.scenes = [Scene(start=0, end=2, voiceover="first scene words here"),
                Scene(start=2, end=4, voiceover="last scene words here", show_captions=False)]
    p.settings.footage_source = "uploads"
    p.settings.ranking = p.settings.whoosh = False
    mp4 = Path(ft.AIVIDEO_DIR).parent / "outputs" / f"{render(p)['id']}.mp4"
    white = lambda px: min(px) > 225
    box = (40, CAPTION_CY - 30, 1040, CAPTION_CY + 30)
    assert count(frame_at(mp4, 1.0), box, white) > 30  # scene 1 has captions
    assert count(frame_at(mp4, 3.0), box, white) == 0  # last scene: none


def test_label_and_ranking_list_can_be_hidden_per_scene():
    ensure_dirs()
    p = AiProject()
    d = ft.project_dir(p.id)
    run_ffmpeg(["-f", "lavfi", "-i", "sine=duration=4", "-c:a", "libmp3lame", str(d / "vo.mp3")])
    p.voiceover = MediaFile(file="vo.mp3", duration=4)
    p.scenes = [Scene(start=0, end=2, voiceover="a", label="SHOWN", rank=1, rank_name="Vatican"),
                Scene(start=2, end=4, voiceover="b", label="HIDDEN", rank=2, rank_name="Monaco",
                      show_label=False, show_ranks=False)]
    p.settings.footage_source = "uploads"
    p.settings.captions = p.settings.whoosh = False
    mp4 = Path(ft.AIVIDEO_DIR).parent / "outputs" / f"{render(p)['id']}.mp4"
    white = lambda px: min(px) > 225
    label_box = (100, LABEL_CY - 60, 980, LABEL_CY + 60)
    gold = lambda px: px[0] > 220 and 170 < px[1] < 225 and px[2] < 110  # revealed #1 pill
    list_box = (30, LIST_TOP, 600, LIST_TOP + 2 * ROW_H)
    first, last = frame_at(mp4, 1.5), frame_at(mp4, 3.5)
    assert count(first, label_box, white) > 20 and count(first, list_box, gold) > 50
    assert count(last, label_box, white) == 0 and count(last, list_box, gold) == 0


@pytest.mark.parametrize("fit", ["fill", "fit_blur", "fit_black", "fullscreen"])
def test_framing(fit):
    ensure_dirs()
    p = AiProject(title="Framing")
    d = ft.project_dir(p.id)
    run_ffmpeg(["-f", "lavfi", "-i", "sine=duration=2", "-c:a", "libmp3lame", str(d / "vo.mp3")])
    p.voiceover = MediaFile(file="vo.mp3", duration=2)
    src = WORK_DIR / f"wide_{fit}.png"
    Image.new("RGB", (1600, 900), (40, 170, 90)).save(src)  # wide green picture
    p.scenes = [Scene(voiceover="hi", upload=ft.save_upload(p.id, "w.png", src), fit=fit, motion="still",
                      show_captions=False)]
    p.settings.footage_source = "uploads"
    p.settings.ranking = p.settings.whoosh = False
    img = frame_at(Path(ft.AIVIDEO_DIR).parent / "outputs" / f"{render(p)['id']}.mp4", 1.0)
    green = lambda px: px[1] > 140 and px[0] < 90 and px[2] < 130
    black = lambda px: max(px) < 25
    banner_edge, below_banner, corner = img.getpixel((5, 130)), img.getpixel((540, 320)), img.getpixel((5, 1880))
    assert green(img.getpixel((540, 1100)))  # the picture is always in the middle
    if fit == "fill":
        assert black(banner_edge) and green(below_banner) and green(corner)  # cropped to fill
    elif fit == "fit_black":
        assert black(banner_edge) and black(below_banner) and black(corner)  # bars above/below
    elif fit == "fit_blur":
        assert black(banner_edge) and not black(below_banner) and not black(corner)  # blurred fill
    elif fit == "fullscreen":
        assert green(img.getpixel((5, 60)))  # picture covers where the banner would be


def test_parse_scene_column_and_number_words():
    text = (
        "Scene\tTime\tVoiceover\tOn screen\n"
        "Hook\t0.0–5.8s\tRanking the five tallest mountains.\tSnowy peaks, “#1 has OCEAN rock”\n"
        "#5\t5.8–14.9s\tNumber five: Makalu. 8,485 meters.\tPyramid-shaped peak, “8,485 m”\n"
        "#2\t14.9–24s\tK2 is the Savage Mountain.\tStormy K2, “8,611 m”\n"
        "#1\t24–30s\tAnd number one: Mount Everest. 8,849 meters.\tEverest summit, “8,849 m”, then a fossil\n"
        "Outro\t30–33s\tWhich one would you climb?\tAll peaks as a chart\n"
    )
    scenes = parse_table(text)
    assert [s.rank for s in scenes] == [None, 5, 2, 1, None]
    assert [s.rank_name for s in scenes] == ["", "Makalu", "", "Mount Everest", ""]
    assert scenes[1].label == "8,485 m" and scenes[1].prompt == "Pyramid-shaped peak"
    assert scenes[3].prompt == "Everest summit, then a fossil"
    assert scenes[4].prompt == "All peaks as a chart"


def test_parse_scene_column_as_visuals_when_alone():
    scenes = parse_table("| Time | Voiceover | Scene |\n|---|---|---|\n| 0-3s | Hello there | Castle, “Hi” |\n")
    assert scenes[0].prompt == "Castle" and scenes[0].label == "Hi"


def test_labels_off_for_whole_video():
    ensure_dirs()
    p = AiProject()
    d = ft.project_dir(p.id)
    run_ffmpeg(["-f", "lavfi", "-i", "sine=duration=2", "-c:a", "libmp3lame", str(d / "vo.mp3")])
    p.voiceover = MediaFile(file="vo.mp3", duration=2)
    p.scenes = [Scene(voiceover="a", label="SHOWN")]
    p.settings.footage_source = "uploads"
    p.settings.captions = p.settings.whoosh = p.settings.ranking = p.settings.labels = False
    mp4 = Path(ft.AIVIDEO_DIR).parent / "outputs" / f"{render(p)['id']}.mp4"
    label_box = (100, LABEL_CY - 60, 980, LABEL_CY + 60)
    assert count(frame_at(mp4, 1.0), label_box, lambda px: min(px) > 225) == 0


def test_title_color_and_highlighted_words():
    from app.tools.aivideo.overlay import BANNER_H, base_overlay
    img = base_overlay("Red Blue", {}, set(), None, False, title_color="#FF0000",
                       title_highlights={"blue": "#0000FF"}).convert("RGB")
    left, right = (0, 0, 540, BANNER_H), (540, 0, 1080, BANNER_H)
    is_red = lambda px: px[0] > 200 and px[1] < 60 and px[2] < 60
    is_blue = lambda px: px[2] > 200 and px[0] < 60 and px[1] < 60
    assert count(img, left, is_red) > 500 and count(img, left, is_blue) == 0
    assert count(img, right, is_blue) > 500 and count(img, right, is_red) == 0
    assert AiProject().title_color == "#FFFFFF"  # old projects stay white


@pytest.mark.parametrize("title_on", [True, False])
def test_title_banner_can_be_switched_off(title_on):
    ensure_dirs()
    p = AiProject(title="Hidden Or Shown")
    d = ft.project_dir(p.id)
    run_ffmpeg(["-f", "lavfi", "-i", "sine=duration=2", "-c:a", "libmp3lame", str(d / "vo.mp3")])
    p.voiceover = MediaFile(file="vo.mp3", duration=2)
    src = WORK_DIR / f"green_{title_on}.png"
    Image.new("RGB", (900, 1600), (30, 160, 60)).save(src)
    p.scenes = [Scene(voiceover="hi", upload=ft.save_upload(p.id, "g.png", src), motion="still")]
    p.settings.footage_source = "uploads"
    p.settings.captions = p.settings.ranking = p.settings.whoosh = False
    p.settings.title = title_on
    img = frame_at(Path(ft.AIVIDEO_DIR).parent / "outputs" / f"{render(p)['id']}.mp4", 1.0)
    top = img.getpixel((10, 20))  # left edge of the banner, clear of the title text
    if title_on:
        assert max(top) < 30  # black banner
    else:
        assert top[1] > 120 and top[0] < 80  # footage reaches the top of the frame


def test_clean_image_removes_a_corner_watermark():
    import numpy as np
    from PIL import ImageDraw
    from app.jobs import UserError
    ensure_dirs()
    p = AiProject()
    src = WORK_DIR / "wm.png"
    img = Image.new("RGB", (800, 600), (40, 120, 90))
    ImageDraw.Draw(img).polygon([(740, 510), (748, 532), (770, 540), (748, 548), (740, 570), (732, 548),
                                 (710, 540), (732, 532)], fill=(255, 255, 255))  # sparkle
    img.save(src)
    up = ft.save_upload(p.id, "wm.png", src)
    clean = ft.clean_image(p.id, up.file, (680 / 800, 480 / 600, 110 / 800, 110 / 600))
    assert clean.file != up.file and (ft.project_dir(p.id) / up.file).exists()  # original kept for undo
    px = np.asarray(Image.open(ft.project_dir(p.id) / clean.file).convert("RGB")).astype(int)
    assert np.abs(px[515:565, 715:765] - (40, 120, 90)).max() < 30  # sparkle painted out
    assert np.abs(px[100:200, 100:200] - (40, 120, 90)).max() < 8  # rest untouched
    with pytest.raises(UserError):
        ft.clean_image(p.id, "../../secret.jpg", (0, 0, 0.5, 0.5))
    with pytest.raises(UserError):
        ft.clean_image(p.id, up.file, (0.5, 0.5, 0.001, 0.001))
