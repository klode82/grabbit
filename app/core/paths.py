from __future__ import annotations

import sys
from pathlib import Path


def _base_dir() -> Path:
    """Root directory for bundled, read-only resources (the UI tree and the
    assets folder).

    In a normal source checkout this is the project root (the directory that
    contains main.py and app/). When the app is frozen by PyInstaller, data
    files are unpacked under sys._MEIPASS — this is set for both --onedir and
    --onefile builds, so the same lookup works in either mode.

    Note: this is for *bundled* resources only. User data (logs, settings)
    lives under ~/.config/grabbit and is resolved separately in logger.py and
    settings_manager.py — it must never point inside the bundle.
    """
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    # app/core/paths.py → parents[2] == project root
    return Path(__file__).resolve().parents[2]


BASE_DIR = _base_dir()

# Bundled resource locations, mirrored by the PyInstaller spec's `datas`.
UI_DIR = BASE_DIR / "app" / "ui"
ASSETS_DIR = BASE_DIR / "assets"
