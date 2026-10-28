@echo off
rem ShortsForge launcher for Windows: sets everything up on first run, then starts the app.
cd /d "%~dp0"
title ShortsForge

set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python 3.10 or newer is needed. Download it from https://www.python.org/downloads/
  echo During install, tick "Add python.exe to PATH". Then run this again.
  start "" https://www.python.org/downloads/
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo First run: setting up ^(this takes a minute or two^)...
  %PY% -m venv .venv || (echo Couldn't create the Python environment. & pause & exit /b 1)
)

echo Checking requirements...
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r backend\requirements.txt || echo Warning: couldn't install/update requirements ^(are you offline?^).
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -U yt-dlp >nul 2>nul
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check curl_cffi >nul 2>nul
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check faster-whisper >nul 2>nul

".venv\Scripts\python.exe" -c "import fastapi, uvicorn, yt_dlp, imageio_ffmpeg, PIL" >nul 2>nul || (
  echo Setup is incomplete. Check your internet connection and run this again.
  pause
  exit /b 1
)

if not exist "frontend\dist\index.html" (
  where npm >nul 2>nul || (
    echo The interface isn't built and Node.js isn't installed. Install Node from https://nodejs.org and run this again.
    pause
    exit /b 1
  )
  echo Building the interface...
  pushd frontend
  call npm install || (popd & echo Building the interface failed. & pause & exit /b 1)
  call npm run build || (popd & echo Building the interface failed. & pause & exit /b 1)
  popd
)

".venv\Scripts\python.exe" run.py %*
pause
