import threading
import time
import socket
import sys
import os

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

    window = webview.create_window(
        title="GRABBIT",
        url=f"http://127.0.0.1:{port}",
        width=960,
        height=700,
        min_size=(720, 540),
        resizable=True,
        text_select=False,
    )

    # Pass the detected backend explicitly so pywebview skips failed attempts.
    # gui=None on macOS/Windows means "use the platform default".
    webview.start(gui=gui_backend, debug="--debug" in sys.argv)


if __name__ == "__main__":
    main()
