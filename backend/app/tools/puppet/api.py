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
from .models import Part, Person, PropKind, PuppetProject
from .motions import FPS, MOTIONS, tracks
from .render import PROP, PX, media_dir, render

router = APIRouter()
STORE = PROJECTS_DIR / "puppet"
SIZE = (400 * PX, 800 * PX)
SPOTS = (.25, .75, .5, .15, .85)  # where each new person starts


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


def _merged(p: PuppetProject, project_id: str) -> PuppetProject:
    """The page's copy of a project, with what the server owns put back. Drawings upload on their
    own and people are added and removed on their own, so a save can't undo a newer change."""
    p.id = project_id
    if _path(project_id).exists():
        saved = load(project_id)
        known = {c.id: c for c in saved.characters}
        kept = [c for c in p.characters if c.id in known]
        for c in kept:
            c.parts = known[c.id].parts
        ids = {c.id for c in kept}
        p.characters = kept + [c for c in saved.characters if c.id not in ids]
    return p


def _person(p: PuppetProject, person_id: str) -> Person:
    for c in p.characters:
        if c.id == person_id:
            return c
    raise HTTPException(404, "That person isn't in this story any more.")


def _read_png(file: UploadFile, size: tuple[int, int]) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(file.file.read())).convert("RGBA")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(400, "That drawing couldn't be read. Please try again.") from None
    if img.size != size:
        raise HTTPException(400, "That drawing is the wrong size. Reload the page and try again.")
    return img


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
                "slots": sum(len(c.actions) for c in p.characters),
                "filled": sum(len(c.parts) for c in p.characters),
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
    return save(_merged(p, project_id))


@router.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    _path(project_id).unlink(missing_ok=True)
    shutil.rmtree(media_dir(project_id), ignore_errors=True)
    return {"ok": True}


@router.post("/projects/{project_id}/characters")
def add_person(project_id: str) -> Person:
    p = load(project_id)
    person = Person(start_x=SPOTS[(len(p.characters) - 1) % len(SPOTS)])
    p.characters.append(person)
    save(p)
    return person


@router.delete("/projects/{project_id}/characters/{person_id}")
def remove_person(project_id: str, person_id: str) -> dict:
    p = load(project_id)
    person = _person(p, person_id)
    if len(p.characters) == 1:
        raise HTTPException(400, "A story needs at least one person.")
    p.characters.remove(person)
    save(p)
    for file in person.parts.values():
        (media_dir(project_id) / file).unlink(missing_ok=True)
    return {"ok": True}


@router.post("/projects/{project_id}/characters/{person_id}/parts/{part}")
def upload_part(project_id: str, person_id: str, part: Part, file: UploadFile) -> dict:
    """Save one drawn body part. The drawing board always sends the full figure-sized canvas."""
    p = load(project_id)
    person = _person(p, person_id)
    img = _read_png(file, SIZE)
    old = person.parts.get(part)
    name = f"{part}_{uuid.uuid4().hex[:8]}.png"
    img.save(media_dir(project_id) / name)
    person.parts[part] = name
    save(p)
    if old:
        (media_dir(project_id) / old).unlink(missing_ok=True)
    return {"parts": person.parts}


@router.post("/projects/{project_id}/props/{kind}")
def upload_prop(project_id: str, kind: PropKind, file: UploadFile) -> dict:
    """Save a scene item's picture. The editor draws them, so each kind is sent before a render."""
    load(project_id)
    _read_png(file, (PROP * PX, PROP * PX)).save(media_dir(project_id) / f"prop_{kind}.png")
    return {"ok": True}


@router.post("/projects/{project_id}/track")
def track(project_id: str, p: PuppetProject) -> dict:
    """Every frame's pose, for the live preview."""
    _path(project_id)
    return {"fps": FPS, "tracks": tracks(p)}


@router.post("/projects/{project_id}/render")
def start_render(project_id: str, p: PuppetProject) -> dict:
    p = save(_merged(p, project_id))

    def work(job: jobs.Job) -> dict:
        video = render(p, job)
        latest = load(project_id)
        latest.last_video_id = video["id"]
        save(latest)
        return video

    return jobs.submit("render", work, pool="render").to_dict()
