"""Story Puppets tests: the pose timeline, the joint maths, part uploads and a full render."""
import io
import math

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.config import OUTPUTS_DIR, WORK_DIR, ensure_dirs
from app.ffmpeg_util import probe, run_ffmpeg
from app.main import app
from app.tools.puppet.models import Action, Person, Prop, PuppetProject
from app.tools.puppet.motions import FPS, JOINTS, LEG, MOTIONS, timeline, tracks
from app.tools.puppet.render import (GROUND, H, JOINT, PROP, PX, W, _mul, _rot, draw_figure, media_dir,
                                     load_parts)

client = TestClient(app)


def _part(box: tuple, color: str) -> bytes:
    img = Image.new("RGBA", (400 * PX, 800 * PX), (0, 0, 0, 0))
    ImageDraw.Draw(img).rectangle([v * PX for v in box], fill=color)
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def _figure(project_id: str) -> None:
    for part, box, color in (("torso", (150, 215, 250, 470), "#D02020"),
                             ("head", (130, 60, 270, 215), "#2040D0"),
                             ("legL", (150, 470, 190, 780), "#101010"),
                             ("legR", (210, 470, 250, 780), "#101010"),
                             ("armR", (240, 245, 260, 460), "#20A020")):
        r = client.post(f"/api/puppet/projects/{project_id}/characters/main/parts/{part}",
                        files={"file": ("p.png", _part(box, color), "image/png")})
        assert r.status_code == 200


def test_timeline_has_a_frame_per_tick_and_walks_to_the_target():
    frames = timeline([Action(motion="walk", seconds=2, to=0.9), Action(motion="idle", seconds=1)], 0.2)
    assert len(frames) == 3 * FPS
    assert frames[0][1] == 1 and frames[-1][0] == 0.9
    assert frames[29][0] == pytest.approx(0.55, abs=0.02)
    back = timeline([Action(motion="walk", seconds=1, to=0.1)], 0.8)
    assert back[0][1] == -1  # walking left faces left


def test_actions_ease_into_each_other_and_holds_stay_held():
    legs = JOINTS.index("legL") + 3
    y = JOINTS.index("y") + 3
    frames = timeline([Action(motion="sit", seconds=2), Action(motion="idle", seconds=1)], 0.5)
    assert frames[59][legs] == 72 and frames[59][y] == 215  # still sitting at the end of "sit"
    assert 20 < frames[63][legs] < 60  # getting up, not snapping
    assert abs(frames[-1][legs]) < 1


def test_falling_goes_toward_the_middle_of_the_screen():
    root = JOINTS.index("root") + 3

    def lands_at(x: float) -> float:
        # Rotating clockwise about the feet tips the figure to the right of a right-facing figure.
        row = timeline([Action(motion="fall", seconds=1)], x)[-1]
        return x + row[1] * row[root] / 90 * .3
    assert lands_at(.85) < .85 and lands_at(.15) > .15
    walked = timeline([Action(motion="walk", seconds=1, to=.85), Action(motion="fall", seconds=1)], .2)
    assert walked[-1][1] == 1 and walked[-1][root] == -90


def test_walking_turns_sideways_and_flips_into_each_new_view():
    side, width = 2, 1
    frames = timeline([Action(motion="walk", seconds=1, to=.8), Action(motion="wave", seconds=1),
                       Action(motion="walk", seconds=1, to=.2)], .5)
    assert frames[0][side] == 1 and frames[0][width] == 1  # no flip on the opening frame
    assert frames[29][side] == 1
    wave = frames[30:60]
    assert wave[0][side] == 1 and wave[-1][side] == 0  # auto looks at the camera to wave
    assert min(abs(f[width]) for f in wave) < .3 and all(abs(f[width]) >= .1 for f in wave)
    assert frames[-1][side] == 1 and frames[-1][width] == -1


def test_the_chosen_facing_wins_over_the_automatic_one():
    side, width = 2, 1
    assert timeline([Action(motion="walk", seconds=1, to=.8, face="front")], .2)[-1][side] == 0
    backwards = timeline([Action(motion="walk", seconds=1, to=.8, face="left")], .2)[-1]
    assert backwards[side] == 1 and backwards[width] == -1
    assert timeline([Action(motion="idle", seconds=1, face="right")], .5)[-1][side] == 1
    assert timeline([Action(motion="walk", seconds=1)], .5)[-1][side] == 1  # on the spot


def test_side_walk_keeps_the_feet_on_the_ground():
    keys = dict(MOTIONS["walk"].side)
    stride = keys[0]
    assert stride["y"] == pytest.approx(LEG * (1 - math.cos(math.radians(stride["legR"]))))
    assert stride["legL"] == -stride["legR"] and stride["armL"] == -stride["armR"]


def test_every_motion_is_well_formed():
    for name, m in MOTIONS.items():
        assert m.keys[0][0] == 0 and m.keys[-1][0] == 1, name
        if m.cycle:
            assert m.keys[0][1] == m.keys[-1][1], f"{name} doesn't loop cleanly"
        assert timeline([Action(motion=name, seconds=1)], 0.5)
        if m.side:
            assert m.side[0][0] == 0 and m.side[-1][0] == 1, name
            assert not m.cycle or m.side[0][1] == m.side[-1][1], f"{name} doesn't loop cleanly"
    assert len(timeline([Action(motion="no-such-motion", seconds=1)], 0.5)) == FPS


def test_arm_rotation_turns_clockwise_about_the_shoulder():
    sx, sy = JOINT["armR"]
    a, b, c, d, e, f = _rot(-90, (sx, sy))
    hand = (a * sx + b * (sy + 100) + c, d * sx + e * (sy + 100) + f)
    assert hand == pytest.approx((sx + 100, sy))  # a hanging arm raised to point right
    assert _mul((1, 0, 5, 0, 1, 7), (1, 0, 1, 0, 1, 2)) == (1, 0, 6, 0, 1, 9)


def test_parts_are_checked_and_replaced():
    pid = client.post("/api/puppet/projects").json()["id"]
    url = f"/api/puppet/projects/{pid}/characters/main/parts/head"
    assert client.post(url, files={"file": ("x.png", b"not a png", "image/png")}).status_code == 400
    small = io.BytesIO()
    Image.new("RGBA", (10, 10)).save(small, "PNG")
    assert client.post(url, files={"file": ("x.png", small.getvalue(), "image/png")}).status_code == 400
    # Autosave carries the page's copy of the project; it must not undo a part saved since.
    _figure(pid)
    stale = client.get(f"/api/puppet/projects/{pid}").json()
    client.post(url, files={"file": ("p.png", _part((130, 60, 270, 215), "#00FF00"), "image/png")})
    client.put(f"/api/puppet/projects/{pid}", json=stale)
    assert (media_dir(pid) / client.get(f"/api/puppet/projects/{pid}").json()["characters"][0]["parts"]["head"]).exists()
    assert client.post(f"/api/puppet/projects/{pid}/characters/main/parts/tail",
                       files={"file": ("x.png", b"x", "image/png")}).status_code == 422
    _figure(pid)
    first = client.get(f"/api/puppet/projects/{pid}").json()["characters"][0]["parts"]["head"]
    client.post(url, files={"file": ("p.png", _part((130, 60, 270, 215), "#FF0000"), "image/png")})
    second = client.get(f"/api/puppet/projects/{pid}").json()["characters"][0]["parts"]["head"]
    assert first != second and not (media_dir(pid) / first).exists()


def test_figure_stands_on_the_ground_where_the_pose_says():
    p = PuppetProject(id="stand", scale=1.0)
    client.put("/api/puppet/projects/stand", json=p.model_dump())
    _figure("stand")
    p = PuppetProject.model_validate(client.get("/api/puppet/projects/stand").json())
    frame = Image.new("RGBA", (W, H), "#FFFFFF")
    draw_figure(frame, load_parts(p.id, p.characters[0]), [0.5, 1, 0, *[0] * len(JOINTS)], 1.0)
    ground = round(GROUND * H)
    assert frame.getpixel((W // 2 - 30, ground - 20))[:3] == (16, 16, 16)  # left leg near the feet
    assert frame.getpixel((W // 2, ground - 400))[:3] == (208, 32, 32)  # torso
    assert frame.getpixel((W // 2, ground - 600))[:3] == (32, 64, 208)  # head
    assert frame.getpixel((W // 2 + 300, ground - 400))[:3] == (255, 255, 255)
    # Moved and mirrored: the green arm (screen right when facing right) swaps sides.
    arm_x = W // 2 + 50
    assert frame.getpixel((arm_x, ground - 400))[:3] == (32, 160, 32)
    flipped = Image.new("RGBA", (W, H), "#FFFFFF")
    draw_figure(flipped, load_parts(p.id, p.characters[0]), [0.5, -1, 0, *[0] * len(JOINTS)], 1.0)
    assert flipped.getpixel((W // 2 - 50, ground - 400))[:3] == (32, 160, 32)


def test_back_hair_goes_behind_the_body_but_moves_with_the_head():
    pid = client.post("/api/puppet/projects").json()["id"]
    _figure(pid)
    client.post(f"/api/puppet/projects/{pid}/characters/main/parts/hair",
                files={"file": ("p.png", _part((110, 60, 290, 300), "#FFFF00"), "image/png")})
    p = PuppetProject.model_validate(client.get(f"/api/puppet/projects/{pid}").json())
    frame = Image.new("RGBA", (W, H), "#FFFFFF")
    draw_figure(frame, load_parts(p.id, p.characters[0]), [0.5, 1, 0, *[0] * len(JOINTS)], 1.0)
    ground = round(GROUND * H)
    assert frame.getpixel((W // 2, ground - 520))[:3] == (208, 32, 32)  # the body covers it
    assert frame.getpixel((W // 2 - 80, ground - 520))[:3] == (255, 255, 0)  # seen beside the body
    moved = Image.new("RGBA", (W, H), "#FFFFFF")
    pose = [0.5, 1, 0, *[60 if j == "head" else 0 for j in JOINTS]]
    draw_figure(moved, load_parts(p.id, p.characters[0]), pose, 1.0)
    assert moved.getpixel((W // 2 - 80, ground - 520))[:3] != (255, 255, 0)


def test_side_view_uses_side_art_and_attachments_ride_on_their_part():
    pid = client.post("/api/puppet/projects").json()["id"]
    _figure(pid)

    def side_frame(row_side: int = 1) -> Image.Image:
        p = PuppetProject.model_validate(client.get(f"/api/puppet/projects/{pid}").json())
        frame = Image.new("RGBA", (W, H), "#FFFFFF")
        draw_figure(frame, load_parts(p.id, p.characters[0]), [0.5, 1, row_side, *[0] * len(JOINTS)], 1.0)
        return frame

    def send(part: str, box: tuple, color: str) -> None:
        r = client.post(f"/api/puppet/projects/{pid}/characters/main/parts/{part}",
                        files={"file": ("p.png", _part(box, color), "image/png")})
        assert r.status_code == 200

    ground = round(GROUND * H)
    # No side art yet: the front arm is moved onto the middle shoulder.
    assert side_frame().getpixel((W // 2, ground - 400))[:3] == (32, 160, 32)
    send("torso_side", (170, 215, 230, 470), "#00FF00")
    send("armR_side", (190, 245, 210, 460), "#FF00FF")
    send("head_extra", (150, 20, 250, 60), "#FFFF00")
    send("head_side_extra", (150, 20, 250, 60), "#00FFFF")
    frame = side_frame()
    assert frame.getpixel((W // 2, ground - 400))[:3] == (255, 0, 255)
    assert frame.getpixel((W // 2 - 20, ground - 400))[:3] == (0, 255, 0)
    assert frame.getpixel((W // 2, ground - 740))[:3] == (0, 255, 255)
    assert side_frame(0).getpixel((W // 2, ground - 740))[:3] == (255, 255, 0)  # front view's own


def test_older_saves_become_a_story_with_one_person():
    p = PuppetProject.model_validate({"id": "x", "parts": {"head": "h.png"}, "start_x": .3, "scale": 1.5,
                                      "actions": [{"motion": "wave"}], "bg_color": "#112233"})
    person = p.characters[0]
    assert person.parts == {"head": "h.png"} and person.start_x == .3 and person.scale == 1.5
    assert person.actions[0].motion == "wave" and p.bg_color == "#112233"


def test_people_are_added_and_removed_one_at_a_time():
    pid = client.post("/api/puppet/projects").json()["id"]
    url = f"/api/puppet/projects/{pid}"
    _figure(pid)
    stale = client.get(url).json()
    second = client.post(f"{url}/characters").json()
    assert second["start_x"] != .5
    r = client.post(f"{url}/characters/{second['id']}/parts/head",
                    files={"file": ("p.png", _part((130, 60, 270, 215), "#00FF00"), "image/png")})
    file = media_dir(pid) / r.json()["parts"]["head"]
    # A save from before the person was added can't drop them, or their drawings.
    client.put(url, json=stale)
    saved = client.get(url).json()["characters"]
    assert [c["id"] for c in saved] == ["main", second["id"]] and saved[1]["parts"]
    assert client.delete(f"{url}/characters/nobody").status_code == 404
    assert client.delete(f"{url}/characters/{second['id']}").status_code == 200
    assert not file.exists() and len(client.get(url).json()["characters"]) == 1
    # ...and one from before the removal can't bring them back.
    client.put(url, json={**stale, "characters": saved})
    assert len(client.get(url).json()["characters"]) == 1
    assert client.delete(f"{url}/characters/main").status_code == 400


def test_everyone_starts_together_and_early_finishers_hold_still():
    p = PuppetProject(characters=[Person(id="a", actions=[Action(motion="walk", seconds=1, to=.9)], start_x=.1),
                                  Person(id="b", actions=[Action(motion="wave", seconds=3)]),
                                  Person(id="c", start_x=.7)])
    rows = tracks(p)
    assert {len(r) for r in rows.values()} == {3 * FPS}
    assert rows["a"][0][0] > .1 and rows["a"][-1] == rows["a"][FPS - 1]
    assert rows["c"][0][0] == .7 and rows["c"][0] == rows["c"][-1]
    assert not tracks(PuppetProject())["main"]


def test_two_people_and_scene_items_in_one_video():
    pid = client.post("/api/puppet/projects").json()["id"]
    url = f"/api/puppet/projects/{pid}"
    _figure(pid)
    second = client.post(f"{url}/characters").json()
    client.post(f"{url}/characters/{second['id']}/parts/torso",
                files={"file": ("p.png", _part((150, 215, 250, 470), "#FF00FF"), "image/png")})
    assert client.post(f"{url}/props/house", files={"file": ("p.png", _part((0, 0, 1, 1), "#000"), "image/png")}).status_code == 400
    art = Image.new("RGBA", (PROP * PX, PROP * PX), "#FFFF00")
    png = io.BytesIO()
    art.save(png, "PNG")
    assert client.post(f"{url}/props/house", files={"file": ("p.png", png.getvalue(), "image/png")}).status_code == 200
    p = client.get(url).json()
    p["characters"][0]["start_x"], p["characters"][0]["actions"] = .25, [Action(seconds=1).model_dump()]
    p["characters"][1]["start_x"], p["characters"][1]["scale"] = .75, 1.0
    p["props"] = [Prop(kind="house", x=.25, y=.5, scale=.5).model_dump(),
                  Prop(kind="house", x=.75, y=.7, scale=.5, front=True).model_dump(),
                  Prop(kind="missing", x=.5).model_dump()]
    job = client.post(f"{url}/render", json=p).json()
    job = _wait(job)
    assert job["status"] == "done", job["error"]
    png_path = WORK_DIR / f"{job['result']['id']}.png"
    ensure_dirs()
    run_ffmpeg(["-i", str(OUTPUTS_DIR / f"{job['result']['id']}.mp4"), "-frames:v", "1", str(png_path)])
    img = Image.open(png_path).convert("RGB")
    yellow = lambda c: c[0] > 200 and c[1] > 200 and c[2] < 90  # noqa: E731
    magenta = lambda c: c[0] > 200 and c[1] < 90 and c[2] > 200  # noqa: E731
    ground = round(GROUND * H)
    assert yellow(img.getpixel((W // 4 - 90, H // 2 - 100)))  # the item behind, beside the first head
    assert yellow(img.getpixel((3 * W // 4, 1200)))  # the item in front covers the second person's body
    assert magenta(img.getpixel((3 * W // 4, ground - 500)))  # above it, their body still shows
    assert client.get(f"{url}").json()["props"][0]["kind"] == "house"


def test_render_makes_a_video_where_the_figure_moves():
    pid = client.post("/api/puppet/projects").json()["id"]
    assert "Draw your figure" in _render(pid, [Action(motion="idle", seconds=1)])["error"]
    _figure(pid)
    assert "at least one action" in _render(pid, [])["error"]
    job = _render(pid, [Action(motion="walk", seconds=1.5, to=0.8), Action(motion="wave", seconds=0.5)],
                  start_x=0.2, title="My story")
    assert job["status"] == "done", job["error"]
    video = job["result"]
    assert video["tool"] == "puppet" and video["title"] == "My story"
    mp4 = OUTPUTS_DIR / f"{video['id']}.mp4"
    info = probe(mp4)
    assert (info.width, info.height) == (W, H) and abs(info.duration - 2) < 0.1 and info.has_audio
    ensure_dirs()

    def torso_side(t: float) -> str:
        png = WORK_DIR / f"{video['id']}_{t}.png"
        run_ffmpeg(["-ss", str(t), "-i", str(mp4), "-frames:v", "1", str(png)])
        img = Image.open(png).convert("RGB")
        y = round(GROUND * H) - 380
        red = [x for x in range(0, W, 8) if img.getpixel((x, y))[0] > 170 and img.getpixel((x, y))[1] < 90]
        return sum(red) / len(red) / W
    assert torso_side(0.1) < 0.35 and torso_side(1.9) > 0.7
    listed = {x["id"]: x for x in client.get("/api/puppet/projects").json()}[pid]
    assert listed["thumb"] == f"/media/outputs/{video['id']}.jpg"


def _render(pid: str, actions: list[Action], **fields) -> dict:
    p = PuppetProject(id=pid, actions=actions, **fields)
    return _wait(client.post(f"/api/puppet/projects/{pid}/render", json=p.model_dump()).json())


def _wait(job: dict) -> dict:
    import time
    for _ in range(600):
        job = client.get(f"/api/jobs/{job['id']}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.1)
    raise AssertionError("render didn't finish")
