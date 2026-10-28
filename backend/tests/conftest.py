import os
import sys
import tempfile
from pathlib import Path

# Point the app at a throwaway data folder *before* it is imported.
os.environ["SHORTSFORGE_DATA"] = tempfile.mkdtemp(prefix="shortsforge-test-")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
