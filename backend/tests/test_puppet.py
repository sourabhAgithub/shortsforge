"""Story Puppets tests: the pose timeline, the joint maths, part uploads and a full render."""
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.config import OUTPUTS_DIR, WORK_DIR, ensure_dirs
from app.ffmpeg_util import probe, run_ffmpeg
from app.main import app
from app.tools.puppet.models import Action, PuppetProject
from app.tools.puppet.motions import FPS, JOINTS, MOTIONS, timeline
from app.tools.puppet.render import (GROUND, H, JOINT, PX, W, _mul, _rot, draw_figure, media_dir,
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
        r = client.post(f"/api/puppet/projects/{project_id}/parts/{part}",
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
    legs = JOINTS.index("legL") + 2
    y = JOINTS.index("y") + 2
    frames = timeline([Action(motion="sit", seconds=2), Action(motion="idle", seconds=1)], 0.5)
    assert frames[59][legs] == 72 and frames[59][y] == 215  # still sitting at the end of "sit"
    assert 20 < frames[63][legs] < 60  # getting up, not snapping
    assert abs(frames[-1][legs]) < 1


def test_falling_goes_toward_the_middle_of_the_screen():
    root = JOINTS.index("root") + 2

    def lands_at(x: float) -> float:
        # Rotating clockwise about the feet tips the figure to the right of a right-facing figure.
        row = timeline([Action(motion="fall", seconds=1)], x)[-1]
        return x + row[1] * row[root] / 90 * .3
    assert lands_at(.85) < .85 and lands_at(.15) > .15
    walked = timeline([Action(motion="walk", seconds=1, to=.85), Action(motion="fall", seconds=1)], .2)
    assert walked[-1][1] == 1 and walked[-1][root] == -90


def test_every_motion_is_well_formed():
    for name, m in MOTIONS.items():
        assert m.keys[0][0] == 0 and m.keys[-1][0] == 1, name
        if m.cycle:
            assert m.keys[0][1] == m.keys[-1][1], f"{name} doesn't loop cleanly"
        assert timeline([Action(motion=name, seconds=1)], 0.5)
    assert len(timeline([Action(motion="no-such-motion", seconds=1)], 0.5)) == FPS


def test_arm_rotation_turns_clockwise_about_the_shoulder():
    sx, sy = JOINT["armR"]
    a, b, c, d, e, f = _rot(-90, (sx, sy))
    hand = (a * sx + b * (sy + 100) + c, d * sx + e * (sy + 100) + f)
    assert hand == pytest.approx((sx + 100, sy))  # a hanging arm raised to point right
    assert _mul((1, 0, 5, 0, 1, 7), (1, 0, 1, 0, 1, 2)) == (1, 0, 6, 0, 1, 9)


def test_parts_are_checked_and_replaced():
    pid = client.post("/api/puppet/projects").json()["id"]
    url = f"/api/puppet/projects/{pid}/parts/head"
    assert client.post(url, files={"file": ("x.png", b"not a png", "image/png")}).status_code == 400
    small = io.BytesIO()
    Image.new("RGBA", (10, 10)).save(small, "PNG")
    assert client.post(url, files={"file": ("x.png", small.getvalue(), "image/png")}).status_code == 400
    # Autosave carries the page's copy of the project; it must not undo a part saved since.
    _figure(pid)
    stale = client.get(f"/api/puppet/projects/{pid}").json()
    client.post(url, files={"file": ("p.png", _part((130, 60, 270, 215), "#00FF00"), "image/png")})
    client.put(f"/api/puppet/projects/{pid}", json=stale)
    assert (media_dir(pid) / client.get(f"/api/puppet/projects/{pid}").json()["parts"]["head"]).exists()
    assert client.post(f"/api/puppet/projects/{pid}/parts/tail",
                       files={"file": ("x.png", b"x", "image/png")}).status_code == 422
    _figure(pid)
    first = client.get(f"/api/puppet/projects/{pid}").json()["parts"]["head"]
    client.post(url, files={"file": ("p.png", _part((130, 60, 270, 215), "#FF0000"), "image/png")})
    second = client.get(f"/api/puppet/projects/{pid}").json()["parts"]["head"]
    assert first != second and not (media_dir(pid) / first).exists()


def test_figure_stands_on_the_ground_where_the_pose_says():
    p = PuppetProject(id="stand", scale=1.0)
    client.put("/api/puppet/projects/stand", json=p.model_dump())
    _figure("stand")
    p = PuppetProject.model_validate(client.get("/api/puppet/projects/stand").json())
    frame = Image.new("RGBA", (W, H), "#FFFFFF")
    draw_figure(frame, load_parts(p), [0.5, 1, *[0] * len(JOINTS)], p.scale)
    ground = round(GROUND * H)
    assert frame.getpixel((W // 2 - 30, ground - 20))[:3] == (16, 16, 16)  # left leg near the feet
    assert frame.getpixel((W // 2, ground - 400))[:3] == (208, 32, 32)  # torso
    assert frame.getpixel((W // 2, ground - 600))[:3] == (32, 64, 208)  # head
    assert frame.getpixel((W // 2 + 300, ground - 400))[:3] == (255, 255, 255)
    # Moved and mirrored: the green arm (screen right when facing right) swaps sides.
    arm_x = W // 2 + 50
    assert frame.getpixel((arm_x, ground - 400))[:3] == (32, 160, 32)
    flipped = Image.new("RGBA", (W, H), "#FFFFFF")
    draw_figure(flipped, load_parts(p), [0.5, -1, *[0] * len(JOINTS)], p.scale)
    assert flipped.getpixel((W // 2 - 50, ground - 400))[:3] == (32, 160, 32)


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
    import time
    p = PuppetProject(id=pid, actions=actions, **fields)
    job = client.post(f"/api/puppet/projects/{pid}/render", json=p.model_dump()).json()
    for _ in range(600):
        job = client.get(f"/api/jobs/{job['id']}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.1)
    raise AssertionError("render didn't finish")
