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
    mute: bool = False  # True = don't use this clip's own sound
    # Crop: zoom into the clip, then pick which part shows (0 = left/top, 1 = right/bottom).
    zoom: float = Field(1.0, ge=1.0, le=4.0)
    pan_x: float = Field(0.5, ge=0.0, le=1.0)
    pan_y: float = Field(0.5, ge=0.0, le=1.0)


class MediaFile(BaseModel):
    file: str  # file name inside data/ranking/<project id>/
    name: str = ""  # original file name, for display
    duration: float = 0.0
    url: str = ""


class RankSettings(BaseModel):
    max_seconds: float = 8.0
    clip_length: Literal["max", "full"] = "max"  # "full" = play each trimmed part in full
    # Sound: the clips' own audio, an uploaded track instead, or both mixed.
    audio_mode: Literal["original", "external", "both"] = "original"
    original_volume: float = Field(1.0, ge=0.0, le=2.0)
    external_volume: float = Field(0.8, ge=0.0, le=2.0)
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
    external_audio: MediaFile | None = None
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
