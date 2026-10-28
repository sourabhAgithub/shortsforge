"""Draw the title band and rank list as a transparent 1080x1920 PNG.

The frontend preview (frontend/src/tools/ranking/layout.ts) mirrors these numbers, so keep them in sync.
"""
import re
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

from ...config import FONT_PATH

W, H = 1080, 1920
BAND_H = 420  # black title band at the top; the clip fills the area below
TITLE_MARGIN_X = 50
TITLE_MARGIN_Y = 40
LIST_TOP = BAND_H + 50
LIST_BOTTOM = H - 160
LIST_X = 40
LIST_MAX_W = W - 2 * LIST_X
MAX_LINE_SPACING = 170
WHITE = "#FFFFFF"
MEDALS = {1: "#FFD54A", 2: "#D9DEE5", 3: "#E39A5B"}

_EMOJI = re.compile("[\U0001F000-\U0001FFFF☀-➿️‍⬀-⯿]")


def clean(text: str) -> str:
    """Drop emoji the font can't draw (they'd show as empty boxes)."""
    return _EMOJI.sub("", text or "").strip()


@lru_cache(maxsize=64)
def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size)


def norm_word(w: str) -> str:
    return re.sub(r"[^\w]", "", w.lower())


def title_lines(title: str) -> list[list[str]]:
    lines = [l.split() for l in clean(title).split("\n")]
    lines = [l for l in lines if l]
    if len(lines) > 2:  # the format is two lines; fold the rest into line 2
        lines = [lines[0], [w for l in lines[1:] for w in l]]
    return lines


def stroke_for(size: int) -> int:
    return max(3, round(size * 0.09))


def fit_title_size(lines: list[list[str]], requested: int) -> int:
    max_w = W - 2 * TITLE_MARGIN_X
    max_h = BAND_H - 2 * TITLE_MARGIN_Y
    size = max(24, requested)
    while size > 24:
        f = font(size)
        widest = max((f.getlength(" ".join(l)) for l in lines), default=0) + 2 * stroke_for(size)
        if widest <= max_w and len(lines) * size * 1.15 <= max_h:
            break
        size -= 2
    return size


def draw_title(img: Image.Image, title: str, highlights: dict[str, str], requested: int) -> None:
    lines = title_lines(title)
    if not lines:
        return
    size = fit_title_size(lines, requested)
    f = font(size)
    stroke = stroke_for(size)
    line_h = size * 1.15
    d = ImageDraw.Draw(img)
    space = f.getlength(" ")
    top = (BAND_H - line_h * len(lines)) / 2
    for i, words in enumerate(lines):
        total = sum(f.getlength(w) for w in words) + space * (len(words) - 1)
        x = (W - total) / 2
        y = top + i * line_h + line_h / 2
        for w in words:
            color = highlights.get(norm_word(w), WHITE)
            d.text((x, y), w, font=f, fill=color, anchor="lm",
                   stroke_width=stroke, stroke_fill="black")
            x += f.getlength(w) + space



def rank_metrics(n: int) -> tuple[float, int]:
    spacing = min(MAX_LINE_SPACING, (LIST_BOTTOM - LIST_TOP) / max(n, 1))
    size = int(min(80, spacing * 0.6))
    return spacing, size


def draw_ranks(img: Image.Image, captions: list[str], revealed: set[int], active: int | None,
               highlight_color: str, medal_colors: bool) -> None:
    n = len(captions)
    spacing, base = rank_metrics(n)
    d = ImageDraw.Draw(img)
    for i in range(n):
        rank = i + 1
        y = LIST_TOP + i * spacing + spacing / 2
        num = f"{rank}."
        cap = clean(captions[i]) if rank in revealed else ""
        size = base
        while size > 20:
            f = font(size)
            width = f.getlength(num + (" " + cap if cap else "")) + 2 * stroke_for(size)
            if width <= LIST_MAX_W:
                break
            size -= 2
        f = font(size)
        stroke = max(4, round(size * 0.12))
        if rank == active:
            num_color = cap_color = highlight_color
        else:
            num_color = MEDALS.get(rank, WHITE) if medal_colors else WHITE
            cap_color = WHITE
        x = LIST_X + stroke
        d.text((x, y), num, font=f, fill=num_color, anchor="lm",
               stroke_width=stroke, stroke_fill="black")
        if cap:
            x += f.getlength(num + " ")
            d.text((x, y), cap, font=f, fill=cap_color, anchor="lm",
                   stroke_width=stroke, stroke_fill="black")


def render_overlay(title: str, highlights: dict[str, str], title_size: int, captions: list[str],
                   revealed: set[int], active: int | None, highlight_color: str,
                   medal_colors: bool) -> Image.Image:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(img).rectangle([0, 0, W, BAND_H], fill="black")
    draw_title(img, title, highlights, title_size)
    draw_ranks(img, captions, revealed, active, highlight_color, medal_colors)
    return img
