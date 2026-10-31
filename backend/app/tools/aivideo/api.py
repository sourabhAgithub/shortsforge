"""HTTP routes for the AI Video Generator tool, mounted at /api/aivideo."""
import json
import re
import shutil
import time
import uuid

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel

from ... import jobs
from ...config import PROJECTS_DIR
from ...ffmpeg_util import FFmpegError, probe
from . import footage as ft
from .models import AiProject, Footage, MediaFile
from .render import fill_footage, render, usable
from .script import parse_table, repair_scenes

router = APIRouter()
STORE = PROJECTS_DIR / "aivideo"
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}


def _path(project_id: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", project_id):
        raise HTTPException(404, "Project not found")
    return STORE / f"{project_id}.json"


def load(project_id: str) -> AiProject:
    path = _path(project_id)
    if not path.exists():
        raise HTTPException(404, "Project not found")
    return AiProject.model_validate_json(path.read_text())


def save(p: AiProject) -> AiProject:
    p.updated_at = time.time()
    STORE.mkdir(parents=True, exist_ok=True)
    _path(p.id).write_text(p.model_dump_json(indent=2))
    return p


@router.get("/projects")
def list_projects() -> list[dict]:
    out = []
    if STORE.exists():
        for f in STORE.glob("*.json"):
            try:
                p = AiProject.model_validate(json.loads(f.read_text()))
            except Exception:
                continue
            thumbs = [s.footage.thumb for s in p.scenes if s.footage and s.footage.thumb]
            out.append({
                "id": p.id, "title": " ".join(p.title.split()), "updated_at": p.updated_at,
                "slots": len(p.scenes), "filled": sum(1 for s in p.scenes if s.footage),
                "thumb": thumbs[0] if thumbs else None,
            })
    return sorted(out, key=lambda x: x["updated_at"], reverse=True)


@router.post("/projects")
def create_project() -> AiProject:
    return save(AiProject())


@router.get("/projects/{project_id}")
def get_project(project_id: str) -> AiProject:
    p = load(project_id)
    if repair_scenes(p):
        save(p)
    for s in p.scenes:  # drop references to files that were deleted
        if s.footage and not usable(p.id, s.footage):
            s.footage = None
    p.sounds = [c for c in p.sounds if (ft.project_dir(p.id) / c.file).exists()]
    return p


@router.put("/projects/{project_id}")
def put_project(project_id: str, p: AiProject) -> AiProject:
    p.id = project_id
    return save(p)


@router.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    _path(project_id).unlink(missing_ok=True)
    shutil.rmtree(ft.project_dir(project_id), ignore_errors=True)  # uploads + footage
    return {"ok": True}


class ParseRequest(BaseModel):
    text: str


@router.post("/parse")
def parse(req: ParseRequest) -> dict:
    scenes = parse_table(req.text)
    if not scenes:
        raise HTTPException(400, "No table rows found. Paste a table with the columns Time, Voiceover "
                                 "and On screen (Markdown with | pipes, or copied straight from a doc or sheet).")
    return {"scenes": [s.model_dump() for s in scenes]}


def _receive(project_id: str, file: UploadFile, allowed: set[str], what: str):
    ext = "." + (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in allowed:
        raise HTTPException(400, f"Please choose {what}.")
    tmp = ft.project_dir(project_id) / f"incoming_{uuid.uuid4().hex[:8]}{ext}"
    with open(tmp, "wb") as out:
        shutil.copyfileobj(file.file, out)
    return tmp, ext


def _audio(project_id: str, file: UploadFile, prefix: str, shortest: float = 0.5) -> MediaFile:
    tmp, ext = _receive(project_id, file, AUDIO_EXTS, "an audio file (MP3 or WAV)")
    try:
        info = probe(tmp)
        if not info.has_audio or info.duration < shortest:
            raise FFmpegError("no audio")
    except FFmpegError:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, "That file has no readable audio. Try exporting it as MP3 or WAV.") from None
    dest = tmp.with_name(f"{prefix}_{uuid.uuid4().hex[:6]}{ext}")
    tmp.rename(dest)
    return MediaFile(file=dest.name, name=file.filename or dest.name, duration=round(info.duration, 3),
                     url=ft.media_url(project_id, dest.name))


@router.post("/projects/{project_id}/voiceover")
def upload_voiceover(project_id: str, file: UploadFile) -> MediaFile:
    return _audio(project_id, file, "voiceover")


@router.post("/projects/{project_id}/music")
def upload_music(project_id: str, file: UploadFile) -> MediaFile:
    return _audio(project_id, file, "music")


@router.post("/projects/{project_id}/sounds")
def upload_sound(project_id: str, file: UploadFile) -> MediaFile:
    return _audio(project_id, file, "sound", shortest=0.05)  # a single knock can be very short


class SoundDownload(BaseModel):
    url: str
    title: str = ""


@router.get("/sound-options")
def sound_options(name: str) -> list[dict]:
    """Free downloads for a named sound."""
    from .sfx import find_options

    return find_options(name)


@router.post("/projects/{project_id}/fetch-sound")
def fetch_sound(project_id: str, req: SoundDownload) -> MediaFile:
    """Download a sound from the free library into the project, ready to play and place."""
    from .sfx import fetch

    try:
        return fetch(project_id, req.url, req.title)
    except jobs.UserError as e:
        raise HTTPException(400, str(e)) from None


@router.post("/projects/{project_id}/scene-upload")
def upload_scene_media(project_id: str, file: UploadFile) -> dict:
    tmp, _ = _receive(project_id, file, ft.IMAGE_EXTS | ft.VIDEO_EXTS,
                      "an image (jpg, png, webp) or a video (mp4, mov, webm)")
    try:
        return ft.save_upload(project_id, file.filename or tmp.name, tmp).model_dump()
    except jobs.UserError as e:
        raise HTTPException(400, str(e)) from None


class CleanRequest(BaseModel):
    file: str
    box: tuple[float, float, float, float]  # x, y, w, h as fractions of the image


@router.post("/projects/{project_id}/clean-image")
def clean_image(project_id: str, req: CleanRequest) -> dict:
    """Remove a watermark or logo from an uploaded photo (returns the cleaned copy)."""
    try:
        return ft.clean_image(project_id, req.file, req.box).model_dump()
    except jobs.UserError as e:
        raise HTTPException(400, str(e)) from None


class FootageRequest(BaseModel):
    project: AiProject
    scene_ids: list[str] | None = None  # None = every scene without footage


@router.post("/projects/{project_id}/footage")
def generate_footage(project_id: str, req: FootageRequest) -> dict:
    p = req.project
    p.id = project_id
    if not p.scenes:
        raise HTTPException(400, "Add scenes to the script first.")
    if req.scene_ids is None:
        indexes = list(range(len(p.scenes)))
    else:
        indexes = [i for i, s in enumerate(p.scenes) if s.id in req.scene_ids]

    def work(job: jobs.Job) -> dict:
        job.result = {}  # filled scene by scene so the UI can show thumbnails as they arrive
        return fill_footage(p, indexes, job, 0.0, 1.0, job.result)

    return jobs.submit("footage", work, pool="footage").to_dict()


@router.post("/projects/{project_id}/sync")
def auto_sync(project_id: str, p: AiProject) -> dict:
    """Match scene times and captions to when the words are actually spoken."""
    from .script import is_blank
    from .sync import sync_scenes, transcribe

    p.id = project_id
    if not p.voiceover:
        raise HTTPException(400, "Upload a voiceover first.")
    if not p.scenes or all(is_blank(s) for s in p.scenes):
        raise HTTPException(400, "Add your script (step 3) first, so there's text to match.")
    voice = ft.project_dir(project_id) / p.voiceover.file

    def work(job: jobs.Job) -> dict:
        heard = transcribe(voice, job)
        job.update(0.9, "Matching words to scenes…")
        scenes, unmatched = sync_scenes(p.scenes, heard, probe(voice).duration)
        return {"scenes": [{"id": s.id, "start": s.start, "end": s.end,
                            "captions": [c.model_dump() for c in s.captions or []]} for s in scenes],
                "heard": " ".join(w for w, _, _ in heard), "unmatched": unmatched}

    return jobs.submit("sync", work, pool="footage").to_dict()


@router.post("/projects/{project_id}/suggest-sounds")
def suggest_sounds(project_id: str, p: AiProject) -> dict:
    """Ideas for where sound effects would help, for the sounds added so far and for new ones."""
    from .script import is_blank
    from .suggest import suggest

    p.id = project_id
    if not p.voiceover:
        raise HTTPException(400, "Upload a voiceover first.")
    if not p.scenes or all(is_blank(s) for s in p.scenes):
        raise HTTPException(400, "Add your script (step 3) first, so there's a story to work from.")
    total = probe(ft.project_dir(project_id) / p.voiceover.file).duration

    def work(job: jobs.Job) -> dict:
        job.update(0.2, "Reading your script…")
        return suggest(p, total, job.update)

    return jobs.submit("suggest", work, pool="footage").to_dict()


@router.post("/projects/{project_id}/render")
def start_render(project_id: str, p: AiProject) -> dict:
    p.id = project_id
    save(p)

    def work(job: jobs.Job) -> dict:
        video = render(p, job)
        latest = load(project_id)
        latest.last_video_id = video["id"]
        for s in latest.scenes:
            if s.id in video["scene_footage"]:
                s.footage = Footage.model_validate(video["scene_footage"][s.id])
        save(latest)
        return video

    return jobs.submit("render", work, pool="render").to_dict()
