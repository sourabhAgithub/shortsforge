"""HTTP routes for the Video Generator tool, mounted at /api/videogen."""
import json
import re
import shutil
import time
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel

from ... import jobs
from ...config import PROJECTS_DIR
from ...ffmpeg_util import FFmpegError, make_thumbnail, probe
from .models import MediaFile, VgProject
from .render import group_words, media_dir, render, window

router = APIRouter()
STORE = PROJECTS_DIR / "videogen"
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}


def _path(project_id: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", project_id):
        raise HTTPException(404, "Project not found")
    return STORE / f"{project_id}.json"


def load(project_id: str) -> VgProject:
    path = _path(project_id)
    if not path.exists():
        raise HTTPException(404, "Project not found")
    return VgProject.model_validate_json(path.read_text())


def save(p: VgProject) -> VgProject:
    p.updated_at = time.time()
    STORE.mkdir(parents=True, exist_ok=True)
    _path(p.id).write_text(p.model_dump_json(indent=2))
    return p


def _url(project_id: str, name: str) -> str:
    return f"/media/videogen/{project_id}/{name}"


@router.get("/projects")
def list_projects() -> list[dict]:
    out = []
    if STORE.exists():
        for f in STORE.glob("*.json"):
            try:
                p = VgProject.model_validate(json.loads(f.read_text()))
            except Exception:
                continue
            out.append({
                "id": p.id, "title": " ".join(p.title.split()), "updated_at": p.updated_at,
                "slots": len(p.captions) + len(p.texts), "filled": 1 if p.video else 0,
                "thumb": p.video.thumb if p.video else None,
            })
    return sorted(out, key=lambda x: x["updated_at"], reverse=True)


@router.post("/projects")
def create_project() -> VgProject:
    return save(VgProject())


@router.get("/projects/{project_id}")
def get_project(project_id: str) -> VgProject:
    return load(project_id)


@router.put("/projects/{project_id}")
def put_project(project_id: str, p: VgProject) -> VgProject:
    p.id = project_id
    return save(p)


@router.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    _path(project_id).unlink(missing_ok=True)
    shutil.rmtree(media_dir(project_id), ignore_errors=True)
    return {"ok": True}


def _receive(project_id: str, file: UploadFile, allowed: set[str], what: str, prefix: str):
    _path(project_id)  # validates the id
    ext = "." + (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in allowed:
        raise HTTPException(400, f"Please choose {what}.")
    dest = media_dir(project_id) / f"{prefix}_{uuid.uuid4().hex[:8]}{ext}"
    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out)
    return dest


@router.post("/projects/{project_id}/video")
def upload_video(project_id: str, file: UploadFile) -> MediaFile:
    dest = _receive(project_id, file, VIDEO_EXTS, "a video (mp4, mov, webm)", "video")
    thumb = dest.with_name(dest.stem + "_thumb.jpg")
    try:
        info = probe(dest)
        if info.width == 0 or info.duration < 0.5:
            raise FFmpegError("no video")
        make_thumbnail(dest, thumb, at=0.5, width=360)
    except FFmpegError:
        dest.unlink(missing_ok=True)
        thumb.unlink(missing_ok=True)
        raise HTTPException(400, "That video couldn't be opened. Try exporting it as MP4.") from None
    return MediaFile(file=dest.name, name=file.filename or dest.name, duration=round(info.duration, 3),
                     url=_url(project_id, dest.name), has_audio=info.has_audio,
                     thumb=_url(project_id, thumb.name))


@router.post("/projects/{project_id}/audio")
def upload_audio(project_id: str, file: UploadFile) -> MediaFile:
    dest = _receive(project_id, file, AUDIO_EXTS, "an audio file (MP3 or WAV)", "audio")
    try:
        info = probe(dest)
        if not info.has_audio or info.duration < 0.5:
            raise FFmpegError("no audio")
    except FFmpegError:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, "That file has no readable audio. Try exporting it as MP3 or WAV.") from None
    return MediaFile(file=dest.name, name=file.filename or dest.name, duration=round(info.duration, 3),
                     url=_url(project_id, dest.name))


class CaptionRequest(BaseModel):
    project: VgProject
    source: Literal["video", "audio"] = "video"
    script: str = ""  # optional exact words; their spelling is kept, timed to the speech


@router.post("/projects/{project_id}/auto-captions")
def auto_captions(project_id: str, req: CaptionRequest) -> dict:
    """Listen to the video's or the external audio's speech and time captions to it."""
    from ..aivideo.sync import align, transcribe

    p = req.project
    if not p.video:
        raise HTTPException(400, "Add a video first.")
    if req.source == "audio":
        if not p.audio:
            raise HTTPException(400, "Add an external audio track first.")
        path, shift = media_dir(project_id) / p.audio.file, max(p.settings.audio_start, 0)
    else:
        if not p.video.has_audio:
            raise HTTPException(400, "This video has no sound to listen to. Add an external audio track "
                                     "and caption that instead.")
        path, shift = media_dir(project_id) / p.video.file, -window(p)[0]
    start, end = window(p)
    dur = end - start

    def work(job: jobs.Job) -> dict:
        heard = [(w, s + shift, e + shift) for w, s, e in transcribe(path, job)]
        heard = [h for h in heard if h[0] and h[2] > 0 and h[1] < dur]
        if req.script.split():
            job.update(0.92, "Matching your script to the speech…")
            words = req.script.split()
            heard = [(w, max(s, 0), min(e, dur)) for w, (s, e) in zip(words, align(words, heard, dur))]
        if not heard:
            raise jobs.UserError("No speech was heard in that part of the audio.")
        return {"captions": [c.model_dump() for c in group_words(heard)]}

    return jobs.submit("captions", work, pool="footage").to_dict()


@router.post("/projects/{project_id}/render")
def start_render(project_id: str, p: VgProject) -> dict:
    p.id = project_id
    save(p)

    def work(job: jobs.Job) -> dict:
        video = render(p, job)
        latest = load(project_id)
        latest.last_video_id = video["id"]
        save(latest)
        return video

    return jobs.submit("render", work, pool="render").to_dict()
