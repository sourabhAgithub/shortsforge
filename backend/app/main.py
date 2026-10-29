"""ShortsForge local server: JSON API under /api, media under /media, the built UI everywhere else."""
import base64
import logging
import os
import re
import secrets
import shutil
import uuid

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import downloader, jobs, settings, videos
from .config import (AIVIDEO_DIR, APP_NAME, ASSETS_DIR, DOWNLOADS_DIR, FRONTEND_DIST, OUTPUTS_DIR,
                     RANKING_DIR,
                     WORK_DIR, ensure_dirs)
from .ffmpeg_util import ffmpeg_exe
from .tools import TOOL_ROUTERS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
ensure_dirs()
# Leftovers from renders that were interrupted (e.g. the app was closed mid-render).
for _leftover in WORK_DIR.iterdir():
    if _leftover.is_dir():
        shutil.rmtree(_leftover, ignore_errors=True)
    else:
        _leftover.unlink(missing_ok=True)

app = FastAPI(title=APP_NAME)

# Online deployments set APP_PASSWORD so the browser asks for a login. Unset = open (local use).
_PASSWORD = os.environ.get("APP_PASSWORD", "")
_USERNAME = os.environ.get("APP_USERNAME", "admin")


@app.middleware("http")
async def require_login(request: Request, call_next):
    if not _PASSWORD or request.url.path == "/api/health":
        return await call_next(request)
    try:
        scheme, _, encoded = request.headers.get("authorization", "").partition(" ")
        user, _, password = base64.b64decode(encoded).decode().partition(":")
        ok = scheme.lower() == "basic" and secrets.compare_digest(user.encode(), _USERNAME.encode()) \
            and secrets.compare_digest(password.encode(), _PASSWORD.encode())
    except ValueError:
        ok = False
    if ok:
        return await call_next(request)
    return Response("Login required.", 401, {"WWW-Authenticate": f'Basic realm="{APP_NAME}"'})


@app.exception_handler(Exception)
async def unexpected_error(_: Request, exc: Exception) -> JSONResponse:
    logging.getLogger("shortsforge").exception("Unhandled error")
    return JSONResponse({"detail": "Something went wrong on our side. Please try again."}, 500)


@app.exception_handler(RequestValidationError)
async def bad_request(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse({"detail": "The app sent invalid data. Reload the page and try again."}, 422)


for prefix, router in TOOL_ROUTERS:
    app.include_router(router, prefix=prefix)


@app.get("/api/health")
def health() -> dict:
    import yt_dlp.version
    return {"ok": True, "ffmpeg": ffmpeg_exe(), "yt_dlp": yt_dlp.version.__version__}


class DownloadRequest(BaseModel):
    url: str


@app.post("/api/clips/download")
def start_download(req: DownloadRequest) -> dict:
    def work(job: jobs.Job) -> dict:
        return downloader.public_clip(downloader.download(req.url, job))
    return jobs.submit("download", work).to_dict()


VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}


@app.post("/api/clips/upload")
def upload_clip(file: UploadFile) -> dict:
    ext = "." + (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in VIDEO_EXTS:
        raise HTTPException(400, "Please choose a video file (mp4, mov, webm, mkv).")
    tmp = DOWNLOADS_DIR / f"upload_{uuid.uuid4().hex}{ext}"
    with open(tmp, "wb") as out:
        shutil.copyfileobj(file.file, out)
    try:
        return downloader.public_clip(downloader.register_upload(file.filename or "clip", tmp))
    except jobs.UserError as e:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, str(e)) from None


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "This task is no longer running (the app may have restarted).")
    return job.to_dict()


@app.get("/api/settings")
def get_settings() -> dict:
    return {**settings.load(), "browsers": list(settings.BROWSERS)}


@app.put("/api/settings")
def put_settings(values: dict) -> dict:
    return {**settings.save(values), "browsers": list(settings.BROWSERS)}


@app.get("/api/videos")
def list_videos() -> list[dict]:
    return videos.list_all()


@app.get("/api/videos/{video_id}")
def get_video(video_id: str) -> dict:
    v = videos.get(video_id)
    if not v:
        raise HTTPException(404, "Video not found")
    return v


@app.get("/api/videos/{video_id}/download")
def download_video(video_id: str) -> FileResponse:
    v = videos.get(video_id)
    if not v:
        raise HTTPException(404, "Video not found")
    name = re.sub(r"[^\w\- ]", "", v["title"]).strip().replace(" ", "_")[:60] or "short"
    return FileResponse(videos.paths(video_id)[0], media_type="video/mp4", filename=f"{name}.mp4")


@app.delete("/api/videos/{video_id}")
def delete_video(video_id: str) -> dict:
    try:
        return {"ok": videos.delete(video_id)}
    except ValueError:
        raise HTTPException(404, "Video not found") from None


app.mount("/media/downloads", StaticFiles(directory=DOWNLOADS_DIR), name="downloads")
app.mount("/media/outputs", StaticFiles(directory=OUTPUTS_DIR), name="outputs")
app.mount("/media/aivideo", StaticFiles(directory=AIVIDEO_DIR), name="aivideo")
app.mount("/media/ranking", StaticFiles(directory=RANKING_DIR), name="ranking")
app.mount("/fonts", StaticFiles(directory=ASSETS_DIR / "fonts"), name="fonts")

if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="ui-assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "Not found")
    candidate = (FRONTEND_DIST / path).resolve()
    if path and candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
        return FileResponse(candidate)
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse({"detail": "The UI isn't built yet. Run the start script again."}, 503)
