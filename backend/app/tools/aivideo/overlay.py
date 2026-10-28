"""PNG overlays for AI Video renders (title banner, ranking list, labels, captions).

frontend/src/tools/aivideo/layout.ts mirrors the main numbers for the editor preview.
"""
from PIL import Image, ImageDraw

from ... import textdraw as td

W, H = 1080, 1920
BANNER_H = 260
AREA_H = H - BANNER_H
LIST_X, LIST_TOP, ROW_H, ROW_FONT = 28, BANNER_H + 36, 100, 60
LABEL_CY = 1090
CAPTION_CY = 1650
GOLD = (255, 201, 60)
ACCENT = (86, 105, 255)
MEDALS = {1: "#FFD54A", 2: "#D9DEE5", 3: "#E39A5B"}


def _stroke(size: int, ratio: float = 0.09) -> int:
    return max(3, round(size * ratio))


def _lines_block(lines: list[str], size: int, fill: str, ratio: float, pad: int = 0) -> Image.Image:
    """Transparent image holding centred lines of outlined text."""
    stroke = _stroke(size, ratio)
    line_h = round(size * 1.18)
    width = round(max(td.measure(l, size) for l in lines)) + 2 * stroke + 2 * pad
    img = Image.new("RGBA", (width, line_h * len(lines) + 2 * stroke + 2 * pad), (0, 0, 0, 0))
    for i, line in enumerate(lines):
        x = (width - td.measure(line, size)) / 2
        td.draw(img, x, pad + stroke + line_h * i + line_h / 2, line, size, fill, stroke)
    return img


def banner(img: Image.Image, title: str) -> None:
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, BANNER_H], fill="black")
    for x in range(W):  # accent bar along the bottom of the banner
        t = x / W
        d.line([(x, BANNER_H - 10), (x, BANNER_H)],
               fill=(round(25 + 50 * t), round(65 + 116 * t), round(227 + 28 * t)))
    title = " ".join(title.split())
    if not title:
        return
    lines = [title]
    size = td.fit_size(lines, W - 80, 96)
    if size < 64:
        lines = td.wrap_balanced(title, W - 80, 64)
        size = min(td.fit_size(lines, W - 80, 84), round((BANNER_H - 50) / (1.18 * len(lines))))
    block = _lines_block(lines, size, "white", 0.09)
    img.alpha_composite(block, ((W - block.width) // 2, (BANNER_H - 10 - block.height) // 2))


def rank_list(img: Image.Image, ranks: dict[int, str], revealed: set[int], current: int | None) -> None:
    """Rows #1..#N; '?' until a rank's scene starts. Current row highlighted, #1 always gold."""
    n = max(ranks) if ranks else 0
    for i, rank in enumerate(range(1, n + 1)):
        cy = LIST_TOP + i * ROW_H + ROW_H / 2
        name = ranks.get(rank, "") if rank in revealed else "?"
        name = name or f"Rank {rank}"
        size = ROW_FONT
        while size > 26 and td.measure(f"#{rank}  {name}", size) > 700:
            size -= 2
        num, rest = f"#{rank}", f"  {name}"
        width = td.measure(num + rest, size) + 44
        top, bottom = cy - ROW_H * 0.42, cy + ROW_H * 0.42
        if rank == 1 and rank in revealed:
            fill, fg, stroke = GOLD + (245,), "black", 0
        elif rank == current:
            fill, fg, stroke = ACCENT + (240,), "white", 3
        else:
            fill, fg, stroke = (0, 0, 0, 150), "white", 3
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(overlay).rounded_rectangle([LIST_X, top, LIST_X + width, bottom],
                                                  radius=ROW_H * 0.3, fill=fill)
        img.alpha_composite(overlay)
        num_color = fg if fill[:3] in (GOLD, ACCENT) else MEDALS.get(rank, "white")
        x = LIST_X + 22
        td.draw(img, x, cy, num, size, num_color, stroke)
        rest_color = fg if name != "?" else "#C9C9D1"
        td.draw(img, x + td.measure(num, size), cy, rest, size, rest_color, stroke)


def base_overlay(title: str, ranks: dict[int, str], revealed: set[int], current: int | None,
                 show_ranks: bool, show_banner: bool = True) -> Image.Image:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if show_banner:
        banner(img, title)
    if show_ranks and ranks:
        rank_list(img, ranks, revealed, current)
    return img


def label_image(text: str) -> Image.Image | None:
    text = " ".join(text.split())
    if not td.runs(text):
        return None
    lines = td.wrap_balanced(text, 940, 96)
    size = td.fit_size(lines, 940, 110 if len(lines) == 1 else 92)
    block = _lines_block(lines, size, "white", 0.07, pad=0)
    pad_x, pad_y = 44, 26
    img = Image.new("RGBA", (block.width + 2 * pad_x, block.height + 2 * pad_y), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius=34, fill=ACCENT + (235,),
                        outline=(255, 255, 255, 230), width=5)
    img.alpha_composite(block, (pad_x, pad_y))
    return img


def caption_image(text: str) -> Image.Image | None:
    text = " ".join(text.split())
    if not td.runs(text):
        return None
    lines = td.wrap_balanced(text, 1000, 80)
    size = td.fit_size(lines, 1000, 84)
    return _lines_block(lines, size, "white", 0.11)
