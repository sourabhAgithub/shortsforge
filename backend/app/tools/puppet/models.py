"""Story Puppets project data model (saved as JSON in data/projects/puppet)."""
import time
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]
Part = Literal["head", "torso", "armL", "armR", "legL", "legR"]


class Action(BaseModel):
    """One thing the figure does, in order. `to` walks it to that spot (0 = left, 1 = right)
    during the action; None stays put."""
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    motion: str = "idle"
    seconds: float = Field(2.0, ge=0.3, le=30)
    to: float | None = Field(None, ge=0, le=1)


class PuppetProject(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10])
    title: str = ""
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    parts: dict[Part, str] = {}  # part -> PNG file name in the project's media folder
    bg_color: HexColor = "#BFE3F5"
    ground_color: HexColor = "#7DBE6E"
    start_x: float = Field(0.5, ge=0, le=1)
    scale: float = Field(1.1, ge=0.5, le=1.8)
    actions: list[Action] = []
    last_video_id: str | None = None
