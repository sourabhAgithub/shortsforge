"""Story Puppets project data model (saved as JSON in data/projects/puppet)."""
import time
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]
# A body part ("hair" is the hair behind the body), optionally its side-view art, optionally the
# attachments layer that rides on it.
Part = Annotated[str, StringConstraints(pattern=r"^(hair|head|torso|armL|armR|legL|legR)(_side)?(_extra)?$")]
PropKind = Annotated[str, StringConstraints(pattern=r"^[a-z]{1,20}$")]


def _new_id() -> str:
    return uuid.uuid4().hex[:8]


class Action(BaseModel):
    """One thing a person does, in order. `to` walks them to that spot (0 = left, 1 = right)
    during the action; None stays put. `face` picks the view; "auto" goes sideways for walking
    and for moving across the screen, and looks at the camera otherwise."""
    id: str = Field(default_factory=_new_id)
    motion: str = "idle"
    seconds: float = Field(2.0, ge=0.3, le=30)
    to: float | None = Field(None, ge=0, le=1)
    face: Literal["auto", "front", "left", "right"] = "auto"


class Person(BaseModel):
    """Someone in the story. Everyone's actions start together when the video does."""
    id: str = Field(default_factory=_new_id)
    parts: dict[Part, str] = {}  # part -> PNG file name in the project's media folder
    character: str | None = None  # the built-in character started from, if any
    accessories: dict[str, str] = {}  # slot -> item, chosen in the editor (their art is in `parts`)
    start_x: float = Field(0.5, ge=0, le=1)
    scale: float = Field(1.1, ge=0.5, le=1.8)
    actions: list[Action] = []


class Prop(BaseModel):
    """A house, tree and so on, standing still. (x, y) is the bottom middle of it, 0-1 across and
    down the frame; `front` puts it in front of the people."""
    id: str = Field(default_factory=_new_id)
    kind: PropKind
    x: float = Field(0.5, ge=0, le=1)
    y: float = Field(0.82, ge=0, le=1)
    scale: float = Field(1.0, ge=0.2, le=4)
    flip: bool = False
    front: bool = False


class PuppetProject(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10])
    title: str = ""
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    characters: list[Person] = Field(min_length=1)
    props: list[Prop] = []
    bg_color: HexColor = "#BFE3F5"
    ground_color: HexColor = "#7DBE6E"
    last_video_id: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _one_person(cls, data: dict) -> dict:
        """New projects start with one person; older saves kept that person's fields up here."""
        if isinstance(data, dict) and "characters" not in data:
            data = dict(data)
            person = {k: data.pop(k) for k in ("parts", "character", "accessories", "start_x", "scale",
                                               "actions") if k in data}
            data["characters"] = [{"id": "main", **person}]
        return data
