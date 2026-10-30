"""HTTP routes for the Story Puppets tool, mounted at /api/puppet."""
import io
import json
import re
import shutil
import time
import uuid

from fastapi import APIRouter, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from ... import jobs
from ...config import PROJECTS_DIR
from .models import Part, PuppetProject
from .motions import FPS, MOTIONS, timeline
from .render import PX, media_dir, render

router = APIRouter()
STORE = PROJECTS_DIR / "puppet"
SIZE = (400 * PX, 800 * PX)


def _path(project_id: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", project_id):
        raise HTTPException(404, "Project not found")
    return STORE / f"{project_id}.json"


def load(project_id: str) -> PuppetProject:
    path = _path(project_id)
    if not path.exists():
        raise HTTPException(404, "Project not found")
    return PuppetProject.model_validate_json(path.read_text())


def save(p: PuppetProject) -> PuppetProject:
    p.updated_at = time.time()
    STORE.mkdir(parents=True, exist_ok=True)
    _path(p.id).write_text(p.model_dump_json(indent=2))
    return p


@router.get("/motions")
def motions() -> list[dict]:
    return [{"id": k, "label": m.label, "seconds": m.seconds} for k, m in MOTIONS.items()]


@router.get("/projects")
def list_projects() -> list[dict]:
    out = []
    if STORE.exists():
        for f in STORE.glob("*.json"):
            try:
                p = PuppetProject.model_validate(json.loads(f.read_text()))
            except Exception:
                continue
            out.append({
                "id": p.id, "title": " ".join(p.title.split()), "updated_at": p.updated_at,
                "slots": len(p.actions), "filled": len(p.parts),
                "thumb": f"/media/outputs/{p.last_video_id}.jpg" if p.last_video_id else None,
            })
    return sorted(out, key=lambda x: x["updated_at"], reverse=True)


@router.post("/projects")
def create_project() -> PuppetProject:
    return save(PuppetProject())


@router.get("/projects/{project_id}")
def get_project(project_id: str) -> PuppetProject:
    return load(project_id)


@router.put("/projects/{project_id}")
def put_project(project_id: str, p: PuppetProject) -> PuppetProject:
    p.id = project_id
    if _path(project_id).exists():
        p.parts = load(project_id).parts  # parts upload on their own; never undo a newer one
    return save(p)


@router.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    _path(project_id).unlink(missing_ok=True)
    shutil.rmtree(media_dir(project_id), ignore_errors=True)
    return {"ok": True}


@router.post("/projects/{project_id}/parts/{part}")
def upload_part(project_id: str, part: Part, file: UploadFile) -> dict:
    """Save one drawn body part. The drawing board always sends the full figure-sized canvas."""
    p = load(project_id)
    try:
        img = Image.open(io.BytesIO(file.file.read())).convert("RGBA")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(400, "That drawing couldn't be read. Please try again.") from None
    if img.size != SIZE:
        raise HTTPException(400, "That drawing is the wrong size. Reload the page and try again.")
    old = p.parts.get(part)
    name = f"{part}_{uuid.uuid4().hex[:8]}.png"
    img.save(media_dir(project_id) / name)
    p.parts[part] = name
    save(p)
    if old:
        (media_dir(project_id) / old).unlink(missing_ok=True)
    return {"parts": p.parts}


@router.post("/projects/{project_id}/track")
def track(project_id: str, p: PuppetProject) -> dict:
    """Every frame's pose, for the live preview."""
    _path(project_id)
    return {"fps": FPS, "frames": timeline(p.actions, p.start_x)}


@router.post("/projects/{project_id}/render")
def start_render(project_id: str, p: PuppetProject) -> dict:
    p.id = project_id
    p.parts = load(project_id).parts  # the server's list is the newest (parts upload on their own)
    save(p)

    def work(job: jobs.Job) -> dict:
        video = render(p, job)
        latest = load(project_id)
        latest.last_video_id = video["id"]
        save(latest)
        return video

    return jobs.submit("render", work, pool="render").to_dict()
