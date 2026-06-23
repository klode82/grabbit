from __future__ import annotations

import os
import sys
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from app.core.settings_manager import settings
from app.core.logger import log


def _is_exe(p: str) -> bool:
    """True if *p* is an existing, executable file."""
    return bool(p) and os.path.isfile(p) and os.access(p, os.X_OK)


def _common_locations() -> list[str]:
    """Typical install locations for ffmpeg, including where static builds are
    commonly dropped. Covers the .exe form too so the list works on Windows."""
    home = Path.home()
    dirs = [
        "/usr/local/bin", "/usr/bin", "/bin", "/opt/ffmpeg",
        str(home / "bin"), str(home / ".local" / "bin"),
    ]
    names = ["ffmpeg", "ffmpeg.exe"]
    return [str(Path(d) / n) for d in dirs for n in names]


def _login_shell_path() -> str:
    """Return PATH as the user's login shell sees it, or '' on failure.

    A GUI- or bundle-launched process (and an AppImage launched from the
    desktop) can inherit a reduced PATH that omits entries added in shell init
    files — pyenv, nvm, cargo, or a custom dir like /usr/local/bin/ffmpeg.
    Asking the login+interactive shell reconstructs the PATH the user's
    terminal actually has, autonomously and with no hardcoded paths. POSIX
    only; on Windows PATH is not shell-rc based, so this is skipped.
    """
    if sys.platform == "win32":
        return ""
    shell = os.environ.get("SHELL") or "/bin/bash"
    try:
        out = subprocess.run(
            [shell, "-lic", 'printf "%s" "$PATH"'],
            capture_output=True, text=True, timeout=5,
        )
    except Exception as exc:
        log.debug("login-shell PATH query failed: %s", exc)
        return ""
    text = (out.stdout or "").strip()
    # Init files may print noise; the PATH line is the last one with a pathsep.
    for line in reversed(text.splitlines()):
        line = line.strip()
        if os.pathsep in line:
            return line
    return text


def _detect() -> tuple[Optional[str], str]:
    """Resolution cascade. Returns (path | None, source).

    source ∈ {configured, path, login_shell, common, configured_invalid, none}.
    """
    configured = (settings.get("ffmpeg_path", "") or "").strip()
    if configured and _is_exe(configured):
        return configured, "configured"

    # 1) PATH of the current process (the normal, fast case)
    found = shutil.which("ffmpeg")
    if found:
        return found, "path"

    # 2) PATH as the login shell sees it (recovers shell-rc additions)
    login_path = _login_shell_path()
    if login_path:
        found = shutil.which("ffmpeg", path=login_path)
        if found:
            return found, "login_shell"

    # 3) common static-build locations
    for c in _common_locations():
        if _is_exe(c):
            return c, "common"

    # A path was configured but is wrong, and nothing else was found.
    if configured:
        return None, "configured_invalid"
    return None, "none"


def resolve_ffmpeg() -> Optional[str]:
    """Absolute path to ffmpeg, or None. (Phase 11 will prepend a bundled copy.)"""
    return _detect()[0]


def ffmpeg_info() -> dict:
    """Detection status for the UI: {found: bool, path: str, source: str}."""
    path, source = _detect()
    return {"found": path is not None, "path": path or "", "source": source}
