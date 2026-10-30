"""Video Generator project data model (saved as JSON in data/projects/videogen).

One video, edited: trimmed and framed to 9:16, its own sound muted or kept, an external audio
track mixed in, timed captions and free text placed anywhere on screen. All times are seconds
in the finished video (0 = the trim start).
"""
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
    has_audio: bool = True
    thumb: str = ""  # URL, videos only


class Cue(BaseModel):
    """One caption on screen."""
    text: str
    start: float
    end: float


class TextItem(BaseModel):
    """Free text on the video, centred on (x, y) as fractions of the frame."""
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    text: str = ""
    start: float = 0.0
    end: float = 3.0
    x: float = 0.5
    y: float = 0.3
    size: int = Field(90, ge=24, le=200)
    color: HexColor = "#FFFFFF"
    box: bool = False  # draw a rounded box behind the text
    box_color: HexColor = "#5669FF"


class VgSettings(BaseModel):
    fit: Literal["fill", "fit_blur", "fit_black"] = "fill"
    trim_start: float = 0.0
    trim_end: float | None = None  # None = to the end of the video
    video_sound: bool = True  # False = mute the video's own sound
    video_volume: float = 1.0
    audio_volume: float = 1.0
    audio_start: float = 0.0  # when the external audio starts playing
    captions: bool = True
    caption_y: float = 0.86
    caption_size: int = Field(84, ge=40, le=160)
    caption_color: HexColor = "#FFFFFF"


class VgProject(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10])
    tool: str = "videogen"
    title: str = ""
    video: MediaFile | None = None
    audio: MediaFile | None = None  # external audio
    captions: list[Cue] = []
    texts: list[TextItem] = []
    settings: VgSettings = Field(default_factory=VgSettings)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    last_video_id: str | None = None
