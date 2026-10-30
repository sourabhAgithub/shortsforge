"""Paths and constants shared by the whole app."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load_env_file(path: Path) -> None:
    """Read KEY=value lines from .env (API keys etc.) without overriding real env vars."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file(ROOT / ".env")

DATA_DIR = Path(os.environ.get("SHORTSFORGE_DATA", ROOT / "data"))
DOWNLOADS_DIR = DATA_DIR / "downloads"
PROJECTS_DIR = DATA_DIR / "projects"
OUTPUTS_DIR = DATA_DIR / "outputs"
WORK_DIR = DATA_DIR / "work"
BIN_DIR = DATA_DIR / "bin"
SETTINGS_FILE = DATA_DIR / "settings.json"
AIVIDEO_DIR = DATA_DIR / "aivideo"  # per-project uploads and footage for the AI Video tool
RANKING_DIR = DATA_DIR / "ranking"  # per-project external audio for the Ranking tool
VIDEOGEN_DIR = DATA_DIR / "videogen"  # per-project video and audio for the Video Generator
VOICEOVER_DIR = DATA_DIR / "voiceover"  # MP3s made by the AI Voiceover tool

ASSETS_DIR = ROOT / "assets"
FONT_PATH = ASSETS_DIR / "fonts" / "Montserrat-Black.ttf"
FRONTEND_DIST = ROOT / "frontend" / "dist"

APP_NAME = "ShortsForge"


def ensure_dirs() -> None:
    for d in (DOWNLOADS_DIR, PROJECTS_DIR, OUTPUTS_DIR, WORK_DIR, BIN_DIR, AIVIDEO_DIR, RANKING_DIR,
              VIDEOGEN_DIR, VOICEOVER_DIR):
        d.mkdir(parents=True, exist_ok=True)
