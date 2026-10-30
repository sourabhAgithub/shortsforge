"""Tool registry. To add a tool: create a package next to `ranking/` with an `api.py`
exposing `router`, then add it here. The frontend has a matching list in
frontend/src/tools/registry.tsx."""
from .aivideo.api import router as aivideo_router
from .ranking.api import router as ranking_router
from .videogen.api import router as videogen_router
from .voiceover.api import router as voiceover_router

# (url prefix, router)
TOOL_ROUTERS = [
    ("/api/ranking", ranking_router),
    ("/api/aivideo", aivideo_router),
    ("/api/videogen", videogen_router),
    ("/api/voiceover", voiceover_router),
]
