"""Script parsing (Markdown table -> scenes), scene timing and caption chunking."""
import math
import re

from .models import Scene

_QUOTES = re.compile(r'"([^"]+)"|“([^”]+)”')
# Words that only introduce the quoted on-screen text ("big text", "label") and aren't visuals.
_LEAD_IN = re.compile(r"(?:,?\s*(?:with|and|then)?\s*(?:a\s+)?(?:big|large|bold)?\s*"
                      r"(?:text|label|caption|title|headline)\s*[:=]?\s*)$", re.I)
_NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
# "#5 Name", "No. 5", "Number five: Name", "And number one: Name", "At number 3, Name"
_RANK = re.compile(r"^\s*(?:(?:and|at|coming\s+in\s+at)\s+)?(?:#|no\.?\s*|number\s+)"
                   r"(\d{1,2}|" + "|".join(_NUMBER_WORDS) + r")\b[\s:.\-–—]*([^:,.;–—\-!?]*)", re.I)
_TIME = r"(\d+(?::\d{1,2})?(?:\.\d+)?)"
_RANGE = re.compile(_TIME + r"\s*s?\s*(?:-|–|—|to)\s*" + _TIME + r"\s*s?", re.I)

HEADERS = {
    "time": ("time", "timing", "timestamp", "when"),
    "voiceover": ("voiceover", "voice over", "voice", "narration", "script", "vo", "audio"),
    "screen": ("on screen", "onscreen", "on-screen", "visual", "visuals", "screen", "footage"),
    # A first column like "Hook / #5 / #4 / Outro". If there's no other visuals column, it's the visuals.
    "rank": ("rank", "scene", "#", "no", "no.", "position", "place"),
}


def _seconds(v: str) -> float:
    if ":" in v:
        m, s = v.split(":", 1)
        return int(m) * 60 + float(s)
    return float(v)


def parse_time_range(text: str) -> tuple[float | None, float | None]:
    m = _RANGE.search(text or "")
    if not m:
        return None, None
    return _seconds(m.group(1)), _seconds(m.group(2))


def split_on_screen(text: str) -> tuple[str, str]:
    """'Hilltop castle, label "61 km²"' -> ("61 km²", "Hilltop castle")."""
    labels, prompt, pos = [], "", 0
    for m in _QUOTES.finditer(text):
        before = _LEAD_IN.sub("", text[pos:m.start()])
        prompt += before + " "
        labels.append((m.group(1) or m.group(2)).strip())
        pos = m.end()
    prompt += text[pos:]
    prompt = re.sub(r"\s+", " ", prompt)
    prompt = re.sub(r"\s+([,.;])", r"\1", prompt)
    prompt = re.sub(r",(?:\s*,)+", ",", prompt).strip(" ,;:-–—")
    return " ".join(labels), prompt


def parse_rank(voiceover: str) -> tuple[int | None, str]:
    m = _RANK.match(voiceover or "")
    if not m:
        return None, ""
    n = m.group(1).lower()
    return (int(n) if n.isdigit() else _NUMBER_WORDS.index(n) + 1), m.group(2).strip()[:40]


def _cells(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def _rows(text: str) -> list[list[str]]:
    """Table rows from Markdown pipes or tab-separated text (what docs/sheets/chats copy as)."""
    rows = []
    for line in (text or "").splitlines():
        if line.strip().startswith("|"):
            rows.append(_cells(line))
        elif "\t" in line:
            rows.append([c.strip() for c in line.strip().split("\t")])
    return rows


def _unquote(text: str) -> str:
    text = text.strip()
    if len(text) >= 2 and text[0] in "\"“" and text[-1] in "\"”":
        return text[1:-1].strip()
    return text


def is_blank(scene: Scene) -> bool:
    return not (scene.voiceover.strip() or scene.label.strip() or scene.prompt.strip() or scene.upload)


def parse_table(text: str) -> list[Scene]:
    rows = _rows(text)
    rows = [r for r in rows if not all(re.fullmatch(r":?-{2,}:?", c or "-") for c in r)]
    if not rows:
        return []
    cols: dict[str, int | None] = {"time": 0, "voiceover": 1, "screen": 2, "rank": None}
    header = [c.lower() for c in rows[0]]
    if any(h in names for h in header for names in HEADERS.values()):
        found = {}
        for key, names in HEADERS.items():
            for i, h in enumerate(header):
                if h in names and i not in found.values():
                    found[key] = i
                    break
        if "screen" not in found and "rank" in found and header[found["rank"]] == "scene":
            found["screen"] = found.pop("rank")
        cols.update(found)
        rows = rows[1:]

    scenes = []
    for r in rows:
        get = lambda k: r[cols[k]] if cols[k] is not None and cols[k] < len(r) else ""
        start, end = parse_time_range(get("time"))
        voiceover = _unquote(get("voiceover"))
        label, prompt = split_on_screen(get("screen"))
        rank, name = parse_rank(voiceover)
        if rank is None:
            cell = get("rank").strip()
            rank = int(cell) if re.fullmatch(r"\d{1,2}", cell) else parse_rank(cell)[0]
        if not (voiceover or label or prompt):
            continue
        scenes.append(Scene(start=start, end=end, voiceover=voiceover, label=label, prompt=prompt,
                            rank=rank, rank_name=name))
    return scenes


def word_count(text: str) -> int:
    return len(re.findall(r"\w+", text or ""))


def resolve_timings(scenes: list[Scene], total: float) -> list[tuple[float, float]]:
    """Start/end seconds for every scene, ending exactly at `total` (the voiceover length).

    Uses the script's times when every scene has a start; scales them if the script and audio
    lengths disagree. Otherwise splits the audio by each scene's voiceover word count.
    """
    n = len(scenes)
    if n == 0:
        return []
    starts = [s.start for s in scenes]
    if all(v is not None for v in starts):
        script_end = max([s.end or 0 for s in scenes] + [starts[-1] + 0.5])
        scale = total / script_end if abs(script_end - total) > 1.0 and script_end > 0 else 1.0
        bounds = [0.0] + [min(v * scale, total) for v in starts[1:]] + [total]
        if all(b - a >= 0.5 for a, b in zip(bounds, bounds[1:])):
            return list(zip(bounds, bounds[1:]))
    weights = [max(1, word_count(s.voiceover)) for s in scenes]
    total_w = sum(weights)
    out, t = [], 0.0
    for w in weights:
        d = total * w / total_w
        out.append((t, t + d))
        t += d
    out[-1] = (out[-1][0], total)
    return out


def caption_chunks(text: str) -> list[str]:
    """Split into chunks of 2–4 words (3 where possible), sizes as even as possible."""
    words = text.split()
    if not words:
        return []
    if len(words) <= 4:
        return [" ".join(words)]
    n = math.ceil(len(words) / 3)
    base, extra = divmod(len(words), n)
    out, i = [], 0
    for k in range(n):
        size = base + (1 if k < extra else 0)
        out.append(" ".join(words[i:i + size]))
        i += size
    return out
