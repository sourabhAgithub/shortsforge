"""App-wide user settings stored in data/settings.json."""
import json

from .config import SETTINGS_FILE

BROWSERS = ("none", "chrome", "edge", "firefox", "safari", "brave")
DEFAULTS = {"cookies_browser": "none"}


def load() -> dict:
    try:
        return {**DEFAULTS, **json.loads(SETTINGS_FILE.read_text())}
    except (FileNotFoundError, json.JSONDecodeError):
        return dict(DEFAULTS)


def save(values: dict) -> dict:
    current = load()
    if values.get("cookies_browser") in BROWSERS:
        current["cookies_browser"] = values["cookies_browser"]
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(current, indent=2))
    return current
