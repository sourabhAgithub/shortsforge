"""Finished renders ("My Videos"), stored in data/outputs as <id>.mp4 / .jpg / .json."""
import json
import re
import time
import uuid
from pathlib import Path

from .config import OUTPUTS_DIR


def new_id() -> str:
    return time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]


def paths(video_id: str) -> tuple[Path, Path, Path]:
    if not re.fullmatch(r"[\w-]+", video_id):
        raise ValueError("bad id")
    base = OUTPUTS_DIR / video_id
    return base.with_suffix(".mp4"), base.with_suffix(".jpg"), base.with_suffix(".json")


def public(meta: dict) -> dict:
    vid = meta["id"]
    return {**meta, "video": f"/media/outputs/{vid}.mp4", "thumb": f"/media/outputs/{vid}.jpg",
            "download": f"/api/videos/{vid}/download"}


def save_meta(meta: dict) -> dict:
    paths(meta["id"])[2].write_text(json.dumps(meta, indent=2))
    return public(meta)


def get(video_id: str) -> dict | None:
    try:
        mp4, _, meta = paths(video_id)
        if mp4.exists() and meta.exists():
            return public(json.loads(meta.read_text()))
    except (ValueError, json.JSONDecodeError):
        pass
    return None


def list_all() -> list[dict]:
    out = []
    for meta in OUTPUTS_DIR.glob("*.json"):
        v = get(meta.stem)
        if v:
            out.append(v)
    return sorted(out, key=lambda v: v.get("created_at", 0), reverse=True)


def delete(video_id: str) -> bool:
    found = False
    for p in paths(video_id):
        if p.exists():
            p.unlink()
            found = True
    return found
