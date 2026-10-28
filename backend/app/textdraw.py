"""Bold outlined text with colour emoji, drawn with Pillow.

Text uses the bundled Montserrat Black. Emoji come from the computer's own colour emoji font
(Apple Color Emoji / Segoe UI Emoji / Noto Color Emoji); if none is found, emoji are skipped.
Flags and joined (ZWJ) emoji need a shaping library Pillow usually lacks, so they're skipped too.
"""
import re
import sys
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .config import FONT_PATH

EMOJI_FONTS = {
    "darwin": [("/System/Library/Fonts/Apple Color Emoji.ttc", 160)],
    "win32": [("C:/Windows/Fonts/seguiemj.ttf", 128)],
    "linux": [("/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf", 109),
              ("/usr/share/fonts/noto/NotoColorEmoji.ttf", 109),
              ("/usr/share/fonts/google-noto-emoji/NotoColorEmoji.ttf", 109)],
}

_EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF\u2600-\u27BF\u2300-\u23FF\u2B00-\u2BFF\u2190-\u21FF\u3030\u303D"
    "\u3297\u3299\u00A9\u00AE\u203C\u2049\u2122\u2139]"
)
# Pieces that only make sense inside sequences we can't shape: drop them.
_DROP = re.compile("[\uFE0F\uFE0E\u200D\u20E3\U0001F3FB-\U0001F3FF\U0001F1E6-\U0001F1FF]")


@lru_cache(maxsize=64)
def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size)


@lru_cache(maxsize=1)
def _emoji_font() -> ImageFont.FreeTypeFont | None:
    key = "darwin" if sys.platform == "darwin" else "win32" if sys.platform == "win32" else "linux"
    for path, size in EMOJI_FONTS[key]:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return None


@lru_cache(maxsize=256)
def _emoji_image(ch: str) -> Image.Image | None:
    f = _emoji_font()
    if f is None:
        return None
    try:
        box = f.getbbox(ch)
        if box[2] - box[0] <= 0:
            return None
        img = Image.new("RGBA", (box[2] + 4, box[3] + 4), (0, 0, 0, 0))
        ImageDraw.Draw(img).text((0, 0), ch, font=f, embedded_color=True)
        bbox = img.getbbox()
        return img.crop(bbox) if bbox else None
    except OSError:
        return None


def runs(text: str) -> list[tuple[str, str]]:
    """Split into ("text", ...) and ("emoji", ...) pieces."""
    text = _DROP.sub("", text or "")
    out: list[tuple[str, str]] = []
    buf = ""
    for ch in text:
        if _EMOJI.match(ch):
            if buf:
                out.append(("text", buf))
                buf = ""
            if _emoji_image(ch) is not None:
                out.append(("emoji", ch))
        else:
            buf += ch
    if buf:
        out.append(("text", buf))
    return out


def plain(text: str) -> str:
    """Text with all emoji removed (for AI prompts, search keywords, titles)."""
    return re.sub(r"\s+", " ", _EMOJI.sub("", _DROP.sub("", text or ""))).strip()


def _emoji_size(size: int) -> int:
    return round(size * 0.95)


def measure(text: str, size: int) -> float:
    f = font(size)
    total = 0.0
    for kind, piece in runs(text):
        if kind == "text":
            total += f.getlength(piece)
        else:
            img = _emoji_image(piece)
            total += _emoji_size(size) * img.width / img.height + size * 0.08
    return total


def draw(img: Image.Image, x: float, cy: float, text: str, size: int, fill: str,
         stroke: int, stroke_fill: str = "black") -> None:
    """Draw `text` starting at x, vertically centred on cy."""
    f = font(size)
    d = ImageDraw.Draw(img)
    for kind, piece in runs(text):
        if kind == "text":
            d.text((x, cy), piece, font=f, fill=fill, anchor="lm",
                   stroke_width=stroke, stroke_fill=stroke_fill)
            x += f.getlength(piece)
        else:
            e = _emoji_image(piece)
            h = _emoji_size(size)
            w = round(h * e.width / e.height)
            e = e.resize((w, h), Image.LANCZOS)
            gap = size * 0.04
            img.alpha_composite(e, (round(x + gap), round(cy - h / 2)))
            x += w + 2 * gap


def fit_size(lines: list[str], max_w: float, max_size: int, min_size: int = 24,
             stroke_ratio: float = 0.09) -> int:
    size = max_size
    while size > min_size:
        widest = max((measure(l, size) for l in lines), default=0)
        if widest + 2 * max(3, round(size * stroke_ratio)) <= max_w:
            break
        size -= 2
    return size


def wrap_balanced(text: str, max_w: float, size: int, max_lines: int = 2) -> list[str]:
    """Return 1 line if it fits, else split into the most balanced 2 lines."""
    words = text.split()
    if len(words) < 2 or measure(text, size) <= max_w or max_lines < 2:
        return [text]
    best, best_score = [text], float("inf")
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        score = max(measure(a, size), measure(b, size))
        if score < best_score:
            best, best_score = [a, b], score
    return best
