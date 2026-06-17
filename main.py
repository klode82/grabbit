import threading
import time
import socket
import sys
import os
from pathlib import Path

# Qt WebEngine reads QTWEBENGINE_CHROMIUM_FLAGS at initialisation time,
# which happens during 'import webview' below — not inside main().
# The flags must therefore be set at module level, before the import.
if sys.platform == "linux":
    _gtk_available = False
    try:
        import gi  # noqa: F401
        _gtk_available = True
    except ImportError:
        pass

    if not _gtk_available:
        # --disable-gpu  : prevents black screen on systems with dma_buf issues
        # --log-level=3  : silences internal Chromium noise in the terminal
        os.environ.setdefault(
            "QTWEBENGINE_CHROMIUM_FLAGS",
            "--disable-gpu --log-level=3",
        )
    del _gtk_available

import uvicorn
import webview


def find_free_port() -> int:
    """Bind to port 0 to let the OS assign a free port, then return it."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return s.getsockname()[1]


def start_server(port: int) -> None:
    """Create the FastAPI app and run it with uvicorn on the given port."""
    from app.server import create_app
    app = create_app()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="error")


def wait_for_server(port: int, timeout: float = 10.0) -> bool:
    """Poll until the local server accepts connections or the timeout expires."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except (ConnectionRefusedError, OSError):
            time.sleep(0.1)
    return False


def detect_linux_gui() -> str | None:
    """
    Detect the best available pywebview GUI backend on Linux.

    Tries GTK first (lighter, native on most distros), then Qt.
    Returns None on non-Linux platforms — macOS and Windows use their
    own native webview automatically and don't need an explicit backend.
    """
    if sys.platform != "linux":
        return None

    # Try GTK (requires python3-gi system package)
    try:
        import gi  # noqa: F401
        return "gtk"
    except ImportError:
        pass

    # Try Qt (PySide6 / PyQt6 installed via pip)
    try:
        import qtpy  # noqa: F401
        return "qt"
    except ImportError:
        pass

    # Neither found — let pywebview raise its own error with instructions
    return None


class GrabbitAPI:
    """Python functions exposed to the web UI via pywebview's JS bridge.

    Methods here are callable from JavaScript as:
        await window.pywebview.api.method_name(args)
    """

    def get_clipboard(self) -> str:
        """Return the current clipboard text, or an empty string on failure.

        Uses pyperclip for cross-platform support (xclip/xsel on Linux,
        pbpaste on macOS, win32 on Windows).
        """
        try:
            import pyperclip
            return pyperclip.paste() or ""
        except Exception:
            return ""

    def get_log_path(self) -> str:
        """Return the absolute path to GRABBIT's log file."""
        from app.core.logger import get_log_path
        return get_log_path()

    def open_file(self, path: str) -> None:
        """Open a file with the system's default application."""
        if not path or not path.strip():
            from app.core.logger import log
            log.warning("open_file called with empty path — ignoring")
            return
        import subprocess
        try:
            if sys.platform == "darwin":
                subprocess.Popen(["open", path])
            elif sys.platform == "win32":
                os.startfile(path)  # type: ignore[attr-defined]
            else:
                subprocess.Popen(["xdg-open", path])
        except Exception as exc:
            from app.core.logger import log
            log.error("open_file failed for '%s': %s", path, exc)

    def open_folder(self, path: str) -> None:
        """Open the folder containing *path* in the system file manager."""
        if not path or not path.strip():
            from app.core.logger import log
            log.warning("open_folder called with empty path — ignoring")
            return
        import subprocess
        from pathlib import Path as _Path
        folder = str(_Path(path).parent)
        try:
            if sys.platform == "darwin":
                # -R selects the file inside Finder
                subprocess.Popen(["open", "-R", path])
            elif sys.platform == "win32":
                subprocess.Popen(["explorer", f"/select,{path}"])
            else:
                subprocess.Popen(["xdg-open", folder])
        except Exception as exc:
            from app.core.logger import log
            log.error("open_folder failed for '%s': %s", folder, exc)

    def open_url(self, url: str) -> None:
        """Open *url* in the system's default browser."""
        if not url or not url.strip():
            return
        import subprocess
        try:
            if sys.platform == "darwin":
                subprocess.Popen(["open", url])
            elif sys.platform == "win32":
                subprocess.Popen(["start", url], shell=True)
            else:
                subprocess.Popen(["xdg-open", url])
        except Exception as exc:
            from app.core.logger import log
            log.error("open_url failed for '%s': %s", url, exc)


def main() -> None:
    # Detect GUI backend before doing anything else so we can apply
    # the correct environment flags before Qt WebEngine initialises.
    gui_backend = detect_linux_gui()

    port = find_free_port()

    # Start the FastAPI server in a daemon thread so it exits with the app.
    server_thread = threading.Thread(
        target=start_server,
        args=(port,),
        daemon=True,
        name="grabbit-server",
    )
    server_thread.start()

    if not wait_for_server(port):
        print("[GRABBIT] ERROR: Server failed to start within timeout.", file=sys.stderr)
        sys.exit(1)

    print(f"[GRABBIT] Server running at http://127.0.0.1:{port}")

    # Resolve icon path — assets/ lives next to main.py
    _icon_png = Path(__file__).parent / "assets" / "icon.png"

    window = webview.create_window(
        title="GRABBIT",
        url=f"http://127.0.0.1:{port}",
        width=960,
        height=700,
        min_size=(720, 540),
        resizable=True,
        text_select=False,
        # Expose Python functions to JavaScript via window.pywebview.api
        js_api=GrabbitAPI(),
    )

    def _set_app_icon() -> None:
        """Set the window and taskbar icon after the GUI has initialised.

        Runs inside the pywebview GUI thread via webview.start(func=...).
        Uses QTimer.singleShot(0) to schedule the icon update on the Qt
        main loop so it's safe to call from the webview worker thread.
        """
        if not _icon_png.exists():
            return
        if gui_backend == "qt":
            try:
                from PySide6.QtWidgets import QApplication
                from PySide6.QtCore import QTimer
                from PySide6.QtGui import QIcon

                def _apply() -> None:
                    app = QApplication.instance()
                    if app:
                        icon = QIcon(str(_icon_png))
                        app.setWindowIcon(icon)
                        # Also set on all existing top-level windows
                        for w in app.topLevelWidgets():
                            w.setWindowIcon(icon)

                QTimer.singleShot(0, _apply)
            except Exception as exc:
                print(f"[GRABBIT] Could not set icon (Qt): {exc}", file=sys.stderr)
        # macOS: icon is embedded in the .app bundle at packaging time (Phase 9)
        # Windows: icon is embedded in the .exe by PyInstaller (Phase 9)

    # Pass the detected backend explicitly so pywebview skips failed attempts.
    # gui=None on macOS/Windows means "use the platform default".
    webview.start(gui=gui_backend, debug="--debug" in sys.argv, func=_set_app_icon)


if __name__ == "__main__":
    main()
