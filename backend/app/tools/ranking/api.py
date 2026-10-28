"""HTTP routes for the Ranking Video tool, mounted at /api/ranking."""
import json
import re
import time

from fastapi import APIRouter, HTTPException

from ... import downloader, jobs
from ...config import PROJECTS_DIR
from .models import Project
from .render import render

router = APIRouter()


def _path(project_id: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", project_id):
        raise HTTPException(404, "Project not found")
    return PROJECTS_DIR / f"{project_id}.json"


def load(project_id: str) -> Project:
    path = _path(project_id)
    if not path.exists():
        raise HTTPException(404, "Project not found")
    return Project.model_validate_json(path.read_text())


def save(p: Project) -> Project:
    p.updated_at = time.time()
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    _path(p.id).write_text(p.model_dump_json(indent=2))
    return p


@router.get("/projects")
def list_projects() -> list[dict]:
    out = []
    for f in PROJECTS_DIR.glob("*.json"):
        try:
            p = Project.model_validate(json.loads(f.read_text()))
        except Exception:
            continue
        if p.tool != "ranking":
            continue
        filled = [s for s in p.slots if s.clip]
        out.append({
            "id": p.id, "title": " ".join(p.title.split()), "updated_at": p.updated_at,
            "slots": len(p.slots), "filled": len(filled),
            "thumb": filled[0].clip.get("thumb") if filled else None,
        })
    return sorted(out, key=lambda x: x["updated_at"], reverse=True)


@router.post("/projects")
def create_project() -> Project:
    return save(Project())


@router.get("/projects/{project_id}")
def get_project(project_id: str) -> Project:
    p = load(project_id)
    # Drop clip references whose files were deleted, so the UI shows the slot as empty.
    for s in p.slots:
        if s.clip and not downloader.load_clip(s.clip.get("clip_id", "")):
            s.clip = None
    return p


@router.put("/projects/{project_id}")
def put_project(project_id: str, p: Project) -> Project:
    p.id = project_id
    return save(p)


@router.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    _path(project_id).unlink(missing_ok=True)
    return {"ok": True}


@router.post("/projects/{project_id}/render")
def start_render(project_id: str, p: Project) -> dict:
    p.id = project_id
    save(p)

    def work(job: jobs.Job) -> dict:
        video = render(p, job)
        latest = load(project_id)
        latest.last_video_id = video["id"]
        save(latest)
        return video

    return jobs.submit("render", work, pool="render").to_dict()
