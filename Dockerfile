# ShortsForge for Render (or any Docker host). Local use doesn't need this: run start.sh / start.bat.

# 1. Build the interface.
FROM node:22-bookworm-slim AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2. Python server. FFmpeg comes with imageio-ffmpeg; the emoji font draws emoji in videos.
FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt curl_cffi faster-whisper
COPY backend/ backend/
COPY assets/ assets/
COPY --from=ui /ui/dist frontend/dist

ENV PYTHONUNBUFFERED=1 SHORTSFORGE_DATA=/app/data PORT=8000
WORKDIR /app/backend
# One worker: render and download jobs are tracked in this process's memory.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips="*"
