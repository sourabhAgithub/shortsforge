"""AI Video project data model (saved as JSON in data/projects/aivideo)."""
import time
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]


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
    color: HexColor | None = None  # None = the video's caption colour


class SoundClip(BaseModel):
    """A sound effect or ambience placed on the timeline. The same file can be placed many times."""
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    file: str  # file name inside the project's media folder
    name: str = ""
    url: str = ""
    duration: float = 0.0  # of the file
    start: float = Field(default=0.0, ge=0)  # seconds from the start of the video
    length: float = Field(default=1.0, gt=0)  # how long it plays; longer than the part kept takes = it loops
    volume: float = Field(default=0.7, ge=0, le=1)
    trim_start: float = Field(default=0.0, ge=0)  # seconds cut off the start of the file
    trim_end: float = Field(default=0.0, ge=0)  # seconds cut off the end of the file
    speed: float = Field(default=1.0, ge=0.5, le=3)  # 2 = twice as fast, at the same pitch
    credit: str = ""  # who made it and its licence, for sounds from the free library

    @property
    def part(self) -> float:
        """Seconds of the file that are kept."""
        return max(self.duration - self.trim_start - self.trim_end, 0.05)

    @property
    def played(self) -> float:
        """Seconds the kept part lasts at this speed."""
        return self.part / self.speed


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
    title: bool = True  # False = no title banner; footage fills the whole frame
    captions: bool = True
    labels: bool = True  # False = no on-screen labels anywhere in the video
    ranking: bool = True
    whoosh: bool = True
    music_volume: float = 0.12
    footage_source: Literal["ai", "stock", "uploads"] = "ai"


class AiProject(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10])
    tool: str = "aivideo"
    title: str = ""
    title_color: HexColor = "#FFFFFF"
    # Words drawn in their own colour: normalised word ("smallest") -> "#RRGGBB".
    title_highlights: dict[str, HexColor] = {}
    caption_color: HexColor = "#FFFFFF"
    caption_highlights: dict[str, HexColor] = {}  # same idea as title_highlights
    voiceover: MediaFile | None = None
    music: MediaFile | None = None
    sounds: list[SoundClip] = []  # the sound effects track
    script_text: str = ""
    scenes: list[Scene] = []
    settings: AiSettings = Field(default_factory=AiSettings)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    last_video_id: str | None = None
