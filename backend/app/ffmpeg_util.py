"""Locate ffmpeg (bundled via imageio-ffmpeg, else system) and small helpers around it."""
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .config import BIN_DIR


class FFmpegError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and Path(exe).exists():
            return exe
    except Exception:
        pass
    system = shutil.which("ffmpeg")
    if system:
        return system
    raise FFmpegError(
        "ffmpeg was not found. Re-run the start script so it can install imageio-ffmpeg."
    )


@lru_cache(maxsize=1)
def ffmpeg_dir_for_ytdlp() -> str:
    """yt-dlp wants a folder containing a binary literally called 'ffmpeg'.

    The imageio binary has a versioned name, so we link (or copy) it into data/bin.
    """
    exe = Path(ffmpeg_exe())
    if exe.stem == "ffmpeg":
        return str(exe.parent)
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    target = BIN_DIR / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
    if not target.exists() or target.resolve() != exe.resolve():
        if target.exists() or target.is_symlink():
            target.unlink()
        try:
            os.symlink(exe, target)
        except OSError:
            shutil.copy2(exe, target)
    return str(BIN_DIR)


def run_ffmpeg(args: list[str], timeout: float | None = None) -> str:
    cmd = [ffmpeg_exe(), "-hide_banner", "-nostdin", "-y", *args]
    # FFMPEG_THREADS caps threads on small servers: by default FFmpeg starts one per CPU core of
    # the host, each holding its own full-size frames, which overflows a 512 MB plan.
    threads = os.environ.get("FFMPEG_THREADS")
    if threads:  # every call ends with the output file; -threads must sit right before it
        cmd = [*cmd[:4], "-filter_complex_threads", threads, "-filter_threads", threads,
               *cmd[4:-1], "-threads", threads, cmd[-1]]
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.run(
        cmd, capture_output=True, text=True, errors="replace", timeout=timeout,
        creationflags=creationflags,
    )
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-8:])
        raise FFmpegError(f"ffmpeg failed: {tail}")
    return proc.stderr


@dataclass
class MediaInfo:
    duration: float
    width: int
    height: int
    has_audio: bool


def probe(path: Path) -> MediaInfo:
    """Read duration/size/audio from `ffmpeg -i` output (no ffprobe needed)."""
    cmd = [ffmpeg_exe(), "-hide_banner", "-nostdin", "-i", str(path)]
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.run(cmd, capture_output=True, text=True, errors="replace",
                          creationflags=creationflags)
    out = proc.stderr
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", out)
    if not m:
        raise FFmpegError(f"Could not read video file {path.name}")
    duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    width = height = 0
    vm = re.search(r"Stream #\S+.*?Video:.*?(\d{2,5})x(\d{2,5})", out)
    if vm:
        width, height = int(vm.group(1)), int(vm.group(2))
        rot = re.search(r"rotation of (-?\d+(?:\.\d+)?) degrees", out) or re.search(
            r"rotate\s*:\s*(-?\d+)", out)
        if rot and abs(round(float(rot.group(1)))) % 180 == 90:
            width, height = height, width
    has_audio = re.search(r"Stream #\S+.*?Audio:", out) is not None
    return MediaInfo(duration=duration, width=width, height=height, has_audio=has_audio)


def make_thumbnail(video: Path, out: Path, at: float = 1.0, width: int = 360) -> None:
    info = probe(video)
    t = min(at, max(info.duration / 2, 0))
    run_ffmpeg(["-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1",
                "-vf", f"scale={width}:-2", "-q:v", "4", str(out)])
