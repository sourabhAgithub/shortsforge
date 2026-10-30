"""Delivery tags in a script, ElevenLabs style: "[whispers] Open the door. [long pause] ...".

The free voices can't take directions, so for them each tag becomes something they can do: pause tags
become silence, mood tags change the speed, pitch and volume of the text after them (until the next
tag or the end of the line). Unknown tags are dropped, never read aloud."""
import re
from dataclasses import dataclass

TAG = re.compile(r"\[([^\[\]\n]{1,40})\]")
PAUSES = {"pause": 0.7, "short pause": 0.35, "long pause": 1.6, "beat": 0.5, "silence": 1.2}
LINE_GAP = 0.2  # extra silence between lines, so each line lands on its own

# (words that mark the mood, (rate %, pitch Hz, volume %))
MOODS = [
    (("whisper",), (-12, -8, -40)),
    (("soft", "gentl", "quiet", "calm", "tender"), (-8, -4, -25)),
    (("slow",), (-22, 0, 0)),
    (("nervous", "scared", "afraid", "fear", "anxious", "trembl", "panick"), (6, 6, -10)),
    (("urgent", "hurr", "fast", "quick", "rush"), (22, 4, 10)),
    (("excite", "happy", "cheer", "joy"), (12, 12, 10)),
    (("sad", "cry", "sob", "sorrow"), (-15, -10, -15)),
    (("angr", "shout", "yell", "scream", "furious"), (10, 5, 25)),
    (("serious", "ominous", "dramatic", "dark", "menac", "creep", "mysterious"), (-12, -10, 0)),
]


@dataclass
class Say:
    text: str
    rate: int = 0
    pitch: int = 0
    volume: int = 0


Part = Say | float  # a float is that many seconds of silence


def mood(tag: str) -> tuple[int, int, int]:
    tag = tag.lower()
    for words, effect in MOODS:
        if any(w in tag for w in words):
            return effect
    return (0, 0, 0)


def strip(text: str) -> str:
    """The script without its tags (and without a tag cut off at the end)."""
    return " ".join(re.sub(r"\[[^\]]*$", "", TAG.sub(" ", text)).split())


def parse(text: str, rate: int = 0, pitch: int = 0) -> list[Part]:
    """Lines of speech and pauses, with each line's speed/pitch/volume (the base `rate` and `pitch`
    plus its mood tags)."""
    parts: list[Part] = []

    def say(piece: str, effect: tuple[int, int, int]) -> None:
        piece = " ".join(piece.split())
        if not re.search(r"\w", piece):
            return
        s = Say(piece, max(-50, min(100, rate + effect[0])), max(-50, min(50, pitch + effect[1])),
                max(-80, min(50, effect[2])))
        last = parts[-1] if parts else None
        if isinstance(last, Say) and (last.rate, last.pitch, last.volume) == (s.rate, s.pitch, s.volume):
            last.text += " " + s.text
        else:
            parts.append(s)

    for line in text.splitlines():
        if not strip(line):
            continue
        if parts:
            parts.append(LINE_GAP)
        effect, fresh, pos = (0, 0, 0), True, 0
        for m in TAG.finditer(line):
            say(line[pos:m.start()], effect)
            if line[pos:m.start()].strip():
                fresh = True
            pos = m.end()
            tag = " ".join(m.group(1).lower().split())
            if tag in PAUSES:
                parts.append(PAUSES[tag])
            elif fresh:  # a new tag after some text replaces the mood...
                effect, fresh = mood(tag), False
            else:  # ...tags side by side ("[slowly] [whispers]") add up
                effect = tuple(a + b for a, b in zip(effect, mood(tag)))
        say(line[pos:], effect)

    # Back-to-back pauses become one; none at the very start or end.
    out: list[Part] = []
    for p in parts:
        if isinstance(p, float) and out and isinstance(out[-1], float):
            out[-1] += p
        else:
            out.append(p)
    while out and isinstance(out[0], float):
        out.pop(0)
    while out and isinstance(out[-1], float):
        out.pop()
    return out


def chunks(text: str, limit: int) -> list[str]:
    """Split a long script into pieces under `limit` characters, at line breaks or sentence ends."""
    pieces: list[str] = []
    for line in (ln.strip() for ln in text.splitlines()):
        while len(line) > limit:
            cut = max(line.rfind(". ", 0, limit), line.rfind("… ", 0, limit), line.rfind("? ", 0, limit),
                      line.rfind("! ", 0, limit))
            cut = cut + 1 if cut > 0 else limit
            pieces.append(line[:cut])
            line = line[cut:].strip()
        if line:
            pieces.append(line)
    out: list[str] = []
    for p in pieces:
        if out and len(out[-1]) + 1 + len(p) <= limit:
            out[-1] += "\n" + p
        else:
            out.append(p)
    return out
