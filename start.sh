#!/bin/bash
# ShortsForge launcher for Mac/Linux: sets everything up on first run, then starts the app.
cd "$(dirname "$0")" || exit 1

pause_exit() { echo; read -r -p "Press Enter to close this window..." _; exit 1; }

PY=""
for p in python3.13 python3.12 python3.11 python3.10 python3 python; do
  if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    PY="$p"; break
  fi
done
if [ -z "$PY" ]; then
  echo "Python 3.10 or newer is needed. Download it from https://www.python.org/downloads/, install it, then run this again."
  command -v open >/dev/null && open "https://www.python.org/downloads/"
  pause_exit
fi

if [ ! -x .venv/bin/python ]; then
  echo "First run: setting up (this takes a minute or two)..."
  "$PY" -m venv .venv || { echo "Couldn't create the Python environment."; pause_exit; }
fi

echo "Checking requirements..."
.venv/bin/python -m pip install -q --disable-pip-version-check -r backend/requirements.txt \
  || echo "Warning: couldn't install/update requirements (are you offline?)."
# Keep the downloader fresh: sites change often and old versions stop working.
.venv/bin/python -m pip install -q --disable-pip-version-check -U yt-dlp >/dev/null 2>&1
# Optional: helps with TikTok. Fine if it isn't available for this computer.
.venv/bin/python -m pip install -q --disable-pip-version-check curl_cffi >/dev/null 2>&1
# Optional: speech recognizer for the AI Video "Auto-sync to voiceover" button.
.venv/bin/python -m pip install -q --disable-pip-version-check faster-whisper >/dev/null 2>&1

.venv/bin/python -c "import fastapi, uvicorn, yt_dlp, imageio_ffmpeg, PIL" 2>/dev/null \
  || { echo "Setup is incomplete. Check your internet connection and run this again."; pause_exit; }

if [ ! -f frontend/dist/index.html ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "Building the interface..."
    (cd frontend && npm install && npm run build) || { echo "Building the interface failed."; pause_exit; }
  else
    echo "The interface isn't built and Node.js isn't installed. Install Node from https://nodejs.org and run this again."
    pause_exit
  fi
fi

.venv/bin/python run.py "$@" || pause_exit
