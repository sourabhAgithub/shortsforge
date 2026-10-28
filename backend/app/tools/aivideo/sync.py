"""Auto-sync: find when each script word is spoken in the voiceover, then set scene times and
caption timings from it.

Speech recognition runs locally with faster-whisper (free, offline after a one-time ~140 MB model
download into data/models). The recognised words won't match the script exactly ("#5" is
spoken as "number five", "km²" as "square kilometers"), so the script words are aligned to the
recognised words and any unmatched script words get times interpolated from their neighbours.
"""
import difflib
import os
import re
import subprocess
import threading
from pathlib import Path

from ...config import DATA_DIR
from ...ffmpeg_util import ffmpeg_exe
from ...jobs import Job, UserError
from .models import Cue, Scene
from .script import caption_chunks

MODELS_DIR = DATA_DIR / "models"
_model = None
_model_lock = threading.Lock()

_NUMBERS = {w: str(i) for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
    "fifteen sixteen seventeen eighteen nineteen twenty".split())}


def norm(word: str) -> str:
    w = re.sub(r"[^\w]", "", word.lower())
    return _NUMBERS.get(w, w)


def _load_model(job: Job | None):
    global _model
    with _model_lock:
        if _model is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError:
                raise UserError("Auto-sync needs the speech recognizer, which isn't installed. Close "
                                "the app and run the start script again to install it.") from None
            name = os.environ.get("WHISPER_MODEL", "base")
            if job and not (MODELS_DIR / f"models--Systran--faster-whisper-{name}").exists():
                job.update(0.05, "Downloading the speech model (first time only, about 140 MB)…")
            try:
                _model = WhisperModel(name, device="cpu", compute_type="int8",
                                      download_root=str(MODELS_DIR))
            except Exception:
                raise UserError("Couldn't load the speech model. Check your internet connection "
                                "(it's downloaded once) and try again.") from None
        return _model


def _decode(path: Path):
    import numpy as np
    raw = subprocess.run([ffmpeg_exe(), "-nostdin", "-i", str(path), "-f", "s16le", "-ac", "1",
                          "-ar", "16000", "-"], capture_output=True,
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    if not raw:
        raise UserError("Couldn't read the voiceover audio.")
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768


def transcribe(path: Path, job: Job | None = None) -> list[tuple[str, float, float]]:
    model = _load_model(job)
    if job:
        job.update(0.3, "Listening to the voiceover…")
    segments, _ = model.transcribe(_decode(path), word_timestamps=True)
    return [(w.word.strip(), w.start, w.end) for s in segments for w in (s.words or [])]


def align(script_words: list[str], heard: list[tuple[str, float, float]],
          total: float) -> list[tuple[float, float]]:
    """(start, end) for every script word."""
    n = len(script_words)
    times: list[tuple[float, float] | None] = [None] * n
    a = [norm(w) for w in script_words]
    b = [norm(w) for w, _, _ in heard]
    for block in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(block.size):
            _, s, e = heard[block.b + k]
            times[block.a + k] = (s, e)
    # Fill gaps by spreading unmatched words evenly between the matched neighbours.
    i = 0
    while i < n:
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < n and times[j] is None:
            j += 1
        lo = times[i - 1][1] if i > 0 else 0.0
        hi = times[j][0] if j < n else max(lo, total)
        step = (hi - lo) / (j - i)
        for k in range(i, j):
            times[k] = (lo + step * (k - i), lo + step * (k - i + 1))
        i = j
    return times  # type: ignore[return-value]


def sync_scenes(scenes: list[Scene], heard: list[tuple[str, float, float]], total: float) -> list[Scene]:
    """Set every scene's start/end and caption cues from the aligned word times."""
    words, owner = [], []
    for i, s in enumerate(scenes):
        for w in s.voiceover.split():
            words.append(w)
            owner.append(i)
    if not words:
        raise UserError("The scenes have no voiceover text to match against the audio.")
    times = align(words, heard, total)

    first = {}
    for k, i in enumerate(owner):
        first.setdefault(i, times[k][0])
    starts = []
    for i in range(len(scenes)):
        if i == 0:
            starts.append(0.0)
        elif i in first:
            # Cut slightly before the first word so the new picture lands with the speech.
            starts.append(max(starts[-1] + 0.5, min(first[i] - 0.1, total - 0.5)))
        else:  # a scene without voiceover sits between its neighbours
            starts.append(starts[-1] + 0.5)
    ends = starts[1:] + [total]

    out = []
    for i, s in enumerate(scenes):
        s = s.model_copy(deep=True)
        s.start, s.end = round(starts[i], 2), round(ends[i], 2)
        idx = [k for k, o in enumerate(owner) if o == i]
        cues, pos = [], 0
        for chunk in caption_chunks(s.voiceover):
            size = len(chunk.split())
            cues.append(Cue(text=chunk, start=round(max(times[idx[pos]][0], s.start), 2), end=0))
            pos += size
        for c, nxt in zip(cues, cues[1:] + [None]):
            c.end = round(nxt.start if nxt else s.end, 2)
        s.captions = cues or None
        out.append(s)
    return out
