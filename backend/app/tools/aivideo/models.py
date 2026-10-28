"""AI Video project data model (saved as JSON in data/projects/aivideo)."""
import time
import uuid
from typing import Literal

from pydantic import BaseModel, Field


class MediaFile(BaseModel):
    file: str  # file name inside the project's media folder
    name: str = ""  # original file name, for display
    duration: float = 0.0
    url: str = ""


class Footage(BaseModel):
    kind: Literal["image", "video", "gradient"]
    source: Literal["upload", "ai", "stock", "gradient"]
    file: str | None = None
    thumb: str | None = None  # URL
    note: str = ""  # e.g. why a fallback was used


class Cue(BaseModel):
    """One caption on screen, in seconds from the start of the video."""
    text: str
    start: float
    end: float


class Scene(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    start: float | None = None
    end: float | None = None
    voiceover: str = ""
    label: str = ""
    label_start: float | None = None  # seconds from video start; None = when the scene starts
    label_end: float | None = None  # None = until the scene ends
    prompt: str = ""
    # How a still image moves during the scene ("auto" alternates zoom in / zoom out / pan right).
    motion: Literal["auto", "still", "zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up",
                    "pan_down"] = "auto"
    # How the picture fits the video: crop to fill, show it whole (blurred or black background),
    # or cover the whole frame including the title banner.
    fit: Literal["fill", "fit_blur", "fit_black", "fullscreen"] = "fill"
    rank: int | None = None
    rank_name: str = ""
    upload: Footage | None = None  # user's own image/video for this scene
    footage: Footage | None = None  # what will be used in the render
    captions: list[Cue] | None = None  # None = split the voiceover evenly across the scene
    show_captions: bool = True  # False = no captions while this scene is on screen
    show_label: bool = True  # False = hide the on-screen label box in this scene
    show_ranks: bool = True  # False = hide the ranking list while this scene is on screen


class AiSettings(BaseModel):
    captions: bool = True
    ranking: bool = True
    whoosh: bool = True
    music_volume: float = 0.12
    footage_source: Literal["ai", "stock", "uploads"] = "ai"


class AiProject(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10])
    tool: str = "aivideo"
    title: str = ""
    voiceover: MediaFile | None = None
    music: MediaFile | None = None
    script_text: str = ""
    scenes: list[Scene] = []
    settings: AiSettings = Field(default_factory=AiSettings)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    last_video_id: str | None = None
