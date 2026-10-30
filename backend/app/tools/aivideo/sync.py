"""Auto-sync: find when each script word is spoken in the voiceover, then set scene times and
caption timings from it.

Speech recognition runs locally with faster-whisper (free, offline after a one-time ~140 MB model
download into data/models). The recognised words won't match the script exactly ("#5" is
spoken as "number five", "km²" as "square kilometers"), so the script words are aligned to the
recognised words and any unmatched script words get times interpolated from their neighbours.
Where the voiceover says something different from the script, the captions show what was
actually said, so they always match the voice.
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
                                      cpu_threads=int(os.environ.get("FFMPEG_THREADS", 0)),
                                      download_root=str(MODELS_DIR))
            except Exception:
                raise UserError("Couldn't load the speech model. Check your internet connection "
                                "(it's downloaded once) and try again.") from None
        return _model


def _decode(path: Path):
    import numpy as np
    raw = subprocess.run([ffmpeg_exe(), "-nostdin", "-i", str(path), "-vn", "-f", "s16le", "-ac", "1",
                          "-ar", "16000", "-"], capture_output=True,
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    if not raw:
        raise UserError("Couldn't read the voiceover audio.")
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768


def transcribe(path: Path, job: Job | None = None) -> list[tuple[str, float, float]]:
    model = _load_model(job)
    if job:
        job.update(0.3, "Listening to the voiceover…")
    # Greedy decoding without carrying context: much faster, and the script supplies the exact
    # words anyway, so recognition only needs to be close enough to line up.
    segments, info = model.transcribe(_decode(path), word_timestamps=True, beam_size=1,
                                      condition_on_previous_text=False)
    heard = []
    for s in segments:  # a generator: recognition happens as it's read, so report progress here
        heard += [(w.word.strip(), w.start, w.end) for w in (s.words or [])]
        if job and info.duration:
            done = min(s.end / info.duration, 1)
            job.update(0.3 + 0.6 * done, f"Listening to the voiceover… {round(done * 100)}%")
    return heard


Word = tuple[str, float, float]  # (text, start, end)
# A difference of up to this many words is a misheard word ("Dadi" heard as "Daddy"); more than
# that means the voiceover says something the script doesn't (or the other way round).
SLIP = 3


def _diff(script_words: list[str], heard: list[Word]) -> list[tuple[str, int, int, int, int]]:
    a = [norm(w) for w in script_words]
    b = [norm(w) for w, _, _ in heard]
    return difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()


def _same_words(tag: str, n: int, m: int) -> bool:
    """Whether a diff block is the script's words as spoken (exactly, or slightly misheard)."""
    return tag == "equal" or tag == "replace" and max(n, m) <= SLIP


def align(script_words: list[str], heard: list[Word], total: float) -> list[tuple[float, float]]:
    """(start, end) for every script word."""
    n = len(script_words)
    times: list[tuple[float, float] | None] = [None] * n
    for tag, i1, i2, j1, j2 in _diff(script_words, heard):
        if tag not in ("equal", "replace"):
            continue
        # Spread the script words over the heard words in the same place (one to one if equal).
        for k in range(i1, i2):
            lo = j1 + (k - i1) * (j2 - j1) // (i2 - i1)
            hi = max(lo, j1 + -(-(k - i1 + 1) * (j2 - j1) // (i2 - i1)) - 1)
            times[k] = (heard[lo][1], heard[hi][2])
    # Script words that weren't spoken: spread evenly between the neighbours.
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


def caption_words(script_words: list[str], heard: list[Word],
                  times: list[tuple[float, float]]) -> list[Word]:
    """The words to caption, in time order: the script's spelling where the voiceover says the
    script, and what was actually said where it says something else. Script words that weren't
    spoken get no caption."""
    out: list[Word] = []
    for tag, i1, i2, j1, j2 in _diff(script_words, heard):
        n, m = i2 - i1, j2 - j1
        if _same_words(tag, n, m) or tag == "delete" and n <= SLIP:
            out += [(script_words[k], *times[k]) for k in range(i1, i2)]
        elif tag == "replace" or tag == "insert" and m > SLIP:
            out += heard[j1:j2]
    return out


def _cues(words: list[Word], end: float) -> list[Cue]:
    """2–4 word captions, each shown from its first word until the next one starts, or until
    shortly after its last word when a long pause follows."""
    cues, pos = [], 0
    for chunk in caption_chunks(" ".join(w for w, _, _ in words)):
        size = len(chunk.split())
        cues.append((chunk, words[pos][1], words[pos + size - 1][2]))
        pos += size
    out = []
    for k, (text, a, last) in enumerate(cues):
        nxt = cues[k + 1][1] if k + 1 < len(cues) else end
        b = nxt if nxt - last < 0.6 else last + 0.3
        out.append(Cue(text=text, start=round(a, 2), end=round(max(min(b, end), a + 0.2), 2)))
    return out


def sync_scenes(scenes: list[Scene], heard: list[Word], total: float) -> tuple[list[Scene], list[int]]:
    """Set every scene's start/end and caption cues from the aligned word times. Also returns
    the scenes whose script mostly isn't in the voiceover."""
    words, owner = [], []
    for i, s in enumerate(scenes):
        for w in s.voiceover.split():
            words.append(w)
            owner.append(i)
    if not words:
        raise UserError("The scenes have no voiceover text to match against the audio.")
    times = align(words, heard, total)
    spoken = [False] * len(words)
    for tag, i1, i2, j1, j2 in _diff(words, heard):
        if _same_words(tag, i2 - i1, j2 - j1):
            spoken[i1:i2] = [True] * (i2 - i1)

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

    caps = caption_words(words, heard, times)
    out, unmatched = [], []
    for i, s in enumerate(scenes):
        s = s.model_copy(deep=True)
        s.start, s.end = round(starts[i], 2), round(ends[i], 2)
        mine = [w for w in caps if (starts[i] <= w[1] or i == 0) and (w[1] < ends[i] or i == len(scenes) - 1)]
        s.captions = _cues(mine, s.end)  # empty = no captions (nothing is said in this scene)
        idx = [k for k, o in enumerate(owner) if o == i]
        if idx and sum(spoken[k] for k in idx) < len(idx) / 2:
            unmatched.append(i)
        out.append(s)
    return out, unmatched
