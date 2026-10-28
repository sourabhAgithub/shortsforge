"""Ranking project data model (saved as JSON in data/projects)."""
import random
import time
import uuid
from typing import Literal

from pydantic import BaseModel, Field

MIN_SLOTS, MAX_SLOTS, DEFAULT_SLOTS = 3, 10, 5


class Highlight(BaseModel):
    word: str
    color: str


class Slot(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    url: str = ""
    caption: str = ""
    clip: dict | None = None  # public clip info from the downloader
    start: float | None = None
    end: float | None = None


class RankSettings(BaseModel):
    max_seconds: float = 8.0
    fit_mode: Literal["fit", "fill"] = "fit"
    title_font_size: int = 130
    keyword_color: str = "#2DD4BF"
    highlight_color: str = "#FFE14D"
    medal_colors: bool = True


class Project(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10])
    tool: str = "ranking"
    title: str = ""
    highlights: list[Highlight] = []
    slots: list[Slot] = Field(default_factory=lambda: [Slot() for _ in range(DEFAULT_SLOTS)])
    custom_order: bool = False
    order: list[int] = []  # rank numbers in playback order (only used when custom_order)
    settings: RankSettings = Field(default_factory=RankSettings)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    last_video_id: str | None = None


def countdown(n: int) -> list[int]:
    return list(range(n, 0, -1))


def playback_order(p: Project) -> list[int]:
    n = len(p.slots)
    if p.custom_order and sorted(p.order) == list(range(1, n + 1)):
        return list(p.order)
    return countdown(n)


def shuffled_order(n: int) -> list[int]:
    """Random order that still ends on #1 (the payoff)."""
    rest = list(range(2, n + 1))
    random.shuffle(rest)
    return rest + [1]
