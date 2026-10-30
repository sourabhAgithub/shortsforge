"""The motion library, and the timeline: actions -> one pose per frame.

The browser preview draws these same poses (POST .../track), so preview and video can't drift.
Angles are degrees, clockwise on screen, 0 = hanging straight down / upright. y is figure units
(the figure is 400x800), positive = down. A key leaves out anything that's 0. Side-view art faces
right, so there a negative angle swings a limb forward."""
import math
from dataclasses import dataclass

from .models import Action, PuppetProject

FPS = 30
BLEND = 0.25  # seconds to ease from one action's last pose into the next
TURN = 0.3  # seconds for the paper-flip between two views
LEG = 310  # hip to sole, in figure units
SIDEWAYS = {"walk", "run"}  # motions that look best from the side, even on the spot
JOINTS = ("y", "root", "body", "head", "armL", "armR", "legL", "legR")


@dataclass(frozen=True)
class Motion:
    label: str
    keys: tuple[tuple[float, dict], ...]  # (fraction of the motion, pose)
    cycle: float = 0  # seconds per loop; 0 = plays once, stretched over the action
    seconds: float = 2.0  # default length
    side: tuple[tuple[float, dict], ...] | None = None  # keys for the side view, if they differ


def _bob(arm: float, leg: float, lift: float, lean: float = 0) -> tuple:
    """A walk-style loop: the legs scissor, the arms swing together a little away from the body
    (so they never cross it), and the body lifts on each step."""
    out = arm * .7
    ahead = {"legL": leg, "legR": -leg, "armL": out - arm, "armR": -out - arm, "body": lean}
    behind = {"legL": -leg, "legR": leg, "armL": out + arm, "armR": -out + arm, "body": lean}
    mid = {"armL": out, "armR": -out, "body": lean, "y": -lift}
    return ((0, ahead), (.25, mid), (.5, behind), (.75, mid), (1, ahead))


def _stride(arm: float, leg: float, lift: float, lean: float = 0) -> tuple:
    """A walk seen from the side: limbs swing front to back, each arm against its leg, and the body
    drops as the legs spread so the feet stay on the ground."""
    drop = LEG * (1 - math.cos(math.radians(leg)))
    ahead = {"legL": -leg, "legR": leg, "armL": arm, "armR": -arm, "body": lean, "y": drop}
    behind = {"legL": leg, "legR": -leg, "armL": -arm, "armR": arm, "body": lean, "y": drop}
    mid = {"body": lean, "y": -lift}
    return ((0, ahead), (.25, mid), (.5, behind), (.75, mid), (1, ahead))


SIT_SIDE = {"y": 215, "legL": -72, "legR": -72, "armL": -30, "armR": -30}

MOTIONS: dict[str, Motion] = {
    "idle": Motion("Stand", ((0, {"armL": 3, "armR": -3}), (.5, {"y": -5, "armL": 6, "armR": -6}),
                             (1, {"armL": 3, "armR": -3})), cycle=2.4),
    "walk": Motion("Walk", _bob(16, 24, 10), cycle=1.0, seconds=3,
                   side=_stride(26, 28, 8)),
    "run": Motion("Run", _bob(38, 42, 20, lean=8), cycle=.55, seconds=2,
                  side=_stride(50, 46, 16, lean=10)),
    "wave": Motion("Wave", ((0, {"armR": -150, "head": 4}), (.5, {"armR": -115, "head": -4}),
                            (1, {"armR": -150, "head": 4})), cycle=.8),
    "nod": Motion("Nod", ((0, {}), (.5, {"head": 0, "y": 6, "body": 2}), (1, {})), cycle=.8, seconds=1.6),
    "shake": Motion("Tremble", ((0, {"body": -3, "armL": 18, "armR": -22, "head": -4}),
                                (.5, {"body": 3, "armL": 22, "armR": -18, "head": 4}),
                                (1, {"body": -3, "armL": 18, "armR": -22, "head": -4})), cycle=.16),
    "point": Motion("Point", ((0, {}), (.2, {"armR": -90, "head": 8}), (1, {"armR": -90, "head": 8}))),
    "cheer": Motion("Cheer", ((0, {"armL": 150, "armR": -150}), (.5, {"armL": 165, "armR": -165, "y": -40}),
                              (1, {"armL": 150, "armR": -150})), cycle=.7),
    "jump": Motion("Jump", ((0, {}), (.2, {"y": 14, "armL": -20, "armR": 20}),
                            (.5, {"y": -240, "armL": 150, "armR": -150, "legL": 18, "legR": -18}),
                            (.82, {"y": 14, "armL": 30, "armR": -30}), (1, {})), seconds=1.2),
    "sit": Motion("Sit down", ((0, {}), (.4, {"y": 215, "legL": 72, "legR": -72, "armL": 12, "armR": -12}),
                               (1, {"y": 215, "legL": 72, "legR": -72, "armL": 12, "armR": -12})),
                      side=((0, {}), (.4, SIT_SIDE), (1, SIT_SIDE))),
    "fall": Motion("Fall over", ((0, {}), (.35, {"root": 92, "armL": 40, "armR": -40}),
                                 (.45, {"root": 87, "armL": 50, "armR": -50}),
                                 (.55, {"root": 90, "armL": 45, "armR": -45}),
                                 (1, {"root": 90, "armL": 45, "armR": -45}))),
}


def _pose(m: Motion, t: float, seconds: float, side: int) -> dict[str, float]:
    u = (t / m.cycle) % 1 if m.cycle else min(t / seconds, 1)
    keys = m.side if side and m.side else m.keys
    for (a, pa), (b, pb) in zip(keys, keys[1:]):
        if u <= b:
            k = (u - a) / (b - a)
            k = k * k * (3 - 2 * k)
            return {j: pa.get(j, 0) + (pb.get(j, 0) - pa.get(j, 0)) * k for j in JOINTS}
    return {j: keys[-1][1].get(j, 0) for j in JOINTS}


def _facing(act: Action, move: float, flip: int) -> tuple[int, int]:
    """(side view? 0 or 1, 1 = facing right or -1 = left) for an action moving `move` across."""
    if act.face == "front":
        return 0, flip
    if act.face != "auto":
        return 1, 1 if act.face == "right" else -1
    if abs(move) > 1e-3:
        return 1, 1 if move > 0 else -1
    return int(act.motion in SIDEWAYS), flip


def timeline(actions: list[Action], start_x: float) -> list[list[float]]:
    """One row per frame: [x (0-1), width, side, *JOINTS]. width is 1 or -1 (facing left), passing
    near 0 during a turn; side says which art to draw (0 = front, 1 = side)."""
    frames: list[list[float]] = []
    x, flip, side = start_x, 1, 0
    last = {j: 0.0 for j in JOINTS}
    for k, act in enumerate(actions):
        m = MOTIONS.get(act.motion, MOTIONS["idle"])
        to = x if act.to is None else act.to
        was = side, flip
        side, flip = _facing(act, to - x, flip)
        if not k:  # the story opens already facing the right way
            was = side, flip
        n = max(round(act.seconds * FPS), 1)
        tip = -1 if (to > .5) == (flip > 0) else 1  # falls toward the middle, not off the screen
        for i in range(n):
            t = i / FPS
            pose = _pose(m, t, act.seconds, side)
            pose["root"] *= tip
            if t < BLEND:
                k = t / BLEND
                pose = {j: last[j] + (pose[j] - last[j]) * k for j in JOINTS}
            view, width = side, flip
            if was != (side, flip) and t < TURN:  # squash to a sliver, swap, open out again
                view, width = was if t < TURN / 2 else (side, flip)
                width *= max(abs(1 - 2 * t / TURN), .1)
            frames.append([round(x + (to - x) * (i + 1) / n, 4), round(width, 3), view,
                           *(round(pose[j], 2) for j in JOINTS)])
        last = pose
        x = to
    return frames


def tracks(p: PuppetProject) -> dict[str, list[list[float]]]:
    """Every person's rows, all the same length: anyone who finishes early holds their last pose."""
    rows = {c.id: timeline(c.actions, c.start_x) for c in p.characters}
    total = max(map(len, rows.values()), default=0)
    if not total:
        return rows
    out = {}
    for c in p.characters:
        own = rows[c.id] or [[c.start_x, 1, 0, *[0.0] * len(JOINTS)]]
        out[c.id] = own + [own[-1]] * (total - len(own))
    return out
