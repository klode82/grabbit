from __future__ import annotations

import shutil
import subprocess
import sys

from app.core.logger import log


def notify(title: str, body: str, icon: str | None = None) -> bool:
    """Show a native OS notification. Returns True if one was dispatched.

    Best-effort and non-blocking: every backend uses subprocess.Popen (or a
    fire-and-forget call) so a slow, missing, or misconfigured notifier never
    stalls the caller. Any failure is logged at debug level and swallowed — a
    missed notification must never break or delay a completed download.
    """
    try:
        if sys.platform == "darwin":
            return _notify_macos(title, body)
        if sys.platform == "win32":
            return _notify_windows(title, body, icon)
        return _notify_linux(title, body, icon)
    except Exception as exc:
        log.debug("notify failed: %s", exc)
        return False


def _notify_macos(title: str, body: str) -> bool:
    """macOS: osascript is built in — no dependency.

    Note: the banner shows a generic script-runner icon until GRABBIT ships as
    a proper .app bundle (Phase 10); AppleScript can't override it at runtime.
    """
    def esc(s: str) -> str:
        # AppleScript string literals are double-quoted, so escape backslashes
        # and double quotes; collapse newlines so the script stays one line.
        return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")

    script = f'display notification "{esc(body)}" with title "{esc(title)}"'
    subprocess.Popen(["osascript", "-e", script])
    return True


def _notify_linux(title: str, body: str, icon: str | None) -> bool:
    """Linux: notify-send (libnotify), present on most desktops.

    Degrades silently when libnotify is not installed rather than raising.
    """
    if not shutil.which("notify-send"):
        log.debug("notify-send not found — skipping Linux notification")
        return False
    cmd = ["notify-send", "--app-name=GRABBIT"]
    if icon:
        cmd += ["-i", icon]
    cmd += [title, body]
    subprocess.Popen(cmd)
    return True


def _notify_windows(title: str, body: str, icon: str | None) -> bool:
    """Windows: winotify — a tiny pure-Python toast wrapper (Win10/11).

    Declared as a Windows-only dependency in requirements.txt. Degrades
    silently if it is somehow absent.
    """
    try:
        from winotify import Notification
    except ImportError:
        log.debug("winotify not installed — skipping Windows notification")
        return False

    kwargs = {"app_id": "GRABBIT", "title": title, "msg": body}
    if icon:
        kwargs["icon"] = icon
    Notification(**kwargs).show()
    return True
