#!/usr/bin/env python3
"""GRABBIT build orchestrator (Linux).

Stages:
  1. PyInstaller onedir build from GRABBIT.spec
  2. Prune unused Qt6 libraries from dist/ to cut size (reversible: edit
     UNUSED_QT_MODULES below and rebuild)
  3. (optional) wrap dist/GRABBIT into an AppImage  [--appimage]

Usage:
  python build.py                # build + prune
  python build.py --no-prune     # build only, keep full Qt
  python build.py --no-build     # prune an existing dist/ (skip PyInstaller)
  python build.py --appimage     # build + prune + AppImage
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist" / "GRABBIT"
INTERNAL = DIST / "_internal"
QT_LIB = INTERNAL / "PySide6" / "Qt" / "lib"
QT_QML = INTERNAL / "PySide6" / "Qt" / "qml"
PYSIDE = INTERNAL / "PySide6"
ICON = ROOT / "assets" / "icon.png"

# AppImage squashfs compression. "xz" is slowest to build but smallest to ship;
# build_appimage falls back to the default automatically if a given
# appimagetool build doesn't accept --comp. Set to "" to always use the default.
COMPRESSION = "xz"

# ── Qt modules safe to remove for a WebEngine-Widgets app with an HTML UI ─────
# WebEngine itself pulls Core/Gui/Widgets/Network/Qml/Quick/QmlModels/OpenGL/
# WebChannel/PrintSupport/ShaderTools/WaylandClient/Positioning — those are NOT
# listed here and remain. If the UI ever goes blank after a build, remove the
# suspect entry from this list and rebuild; the prune is purely subtractive.
UNUSED_QT_MODULES = [
    # 3D
    "3D", "Quick3D",
    # QML widget toolkit (our UI is HTML, so none of this is used)
    "QuickControls2", "QuickTemplates2", "QuickDialogs2",
    "LabsStyleKit", "LabsAnimation", "LabsQmlModels", "LabsSharedImage",
    # data viz
    "Charts", "DataVisualization", "Graphs",
    # media (WebEngine handles HTML5 media internally)
    "Multimedia", "SpatialAudio",
    # misc unused subsystems
    "Location", "RemoteObjects", "WaylandCompositor", "Pdf", "WebEngineQuick",
    "Sql", "Test", "Bluetooth", "Nfc", "Sensors", "SerialPort", "SerialBus",
    "Designer", "Help", "Scxml", "StateMachine", "NetworkAuth", "TextToSpeech",
]

# ── QML modules safe to remove (qml/<dir>) ────────────────────────────────────
# Our UI is HTML rendered by QtWebEngineWidgets; nothing imports QtQuick at
# runtime, so the QML module trees are dead weight. Two tiers:
#   • SAFE: 1:1 with libraries already pruned above, or plainly unused.
#   • HTML-UI ASSUMPTION: QtQuick / Qt5Compat / Qt — only loaded by QML code,
#     of which we have none. Biggest win (~22 MB). If the webview ever renders
#     blank, RESTORE THESE THREE FIRST (they're the only non-obvious cut).
# Tiny, WebEngine-adjacent modules (QtQml, QtCore, QtNetwork, QtWebChannel,
# QtPositioning, QtWebSockets) are deliberately left in.
UNUSED_QML_MODULES = [
    # safe — match pruned libraries / unused subsystems
    "QtQuick3D", "Qt3D", "QtGraphs", "QtCharts", "QtDataVisualization",
    "QtLocation", "QtMultimedia", "QtTextToSpeech", "QtSensors", "QtScxml",
    "QtRemoteObjects", "QtTest", "QtWayland", "QtWebView", "QtWebEngine",
    # HTML-UI assumption — restore first if the webview goes blank
    "QtQuick", "Qt5Compat", "Qt",
]


def _human(n: int) -> str:
    return f"{n / 1_000_000:.0f} MB"


def run_pyinstaller() -> None:
    print(">> PyInstaller build…")
    subprocess.run(
        [sys.executable, "-m", "PyInstaller", "GRABBIT.spec", "--clean", "--noconfirm"],
        cwd=ROOT, check=True,
    )


def _real_size(f: Path) -> int:
    """Bytes on disk for a real file; 0 for symlinks (so versioned .so links
    aren't counted twice, matching what `du` reports)."""
    return 0 if f.is_symlink() else f.stat().st_size


def prune() -> None:
    if not QT_LIB.is_dir():
        print(f"!! {QT_LIB} not found — did the build run?", file=sys.stderr)
        return
    print(">> Pruning unused Qt modules…")
    freed = 0
    removed = 0
    for name in UNUSED_QT_MODULES:
        # Shared libraries: libQt6<name>*.so*
        for f in QT_LIB.glob(f"libQt6{name}*.so*"):
            freed += _real_size(f)
            f.unlink()
            removed += 1
        # PySide6 Python bindings: Qt<name>*.abi3.so (+ .pyi if present)
        for f in PYSIDE.glob(f"Qt{name}*.abi3.so"):
            freed += _real_size(f)
            f.unlink()
            removed += 1
    # QML module directories (exact dir-name match — no prefix collisions)
    for name in UNUSED_QML_MODULES:
        d = QT_QML / name
        if d.is_dir():
            freed += sum(_real_size(f) for f in d.rglob("*") if f.is_file())
            shutil.rmtree(d)
            removed += 1
    print(f"   removed {removed} items, freed ~{_human(freed)}")
    # PyInstaller mirrors some Qt libs as symlinks at the _internal/ root
    # pointing into PySide6/Qt/lib. Removing the targets above leaves those
    # links dangling, which later breaks copytree — sweep them out now.
    dangling = 0
    for f in DIST.rglob("*"):
        if f.is_symlink() and not f.exists():   # exists() follows the link
            f.unlink()
            dangling += 1
    if dangling:
        print(f"   cleaned {dangling} dangling symlinks")
    # Report the new total via du (authoritative; counts disk usage like the shell)
    try:
        out = subprocess.run(["du", "-sh", str(DIST)], capture_output=True, text=True)
        print(f"   dist/GRABBIT now {out.stdout.split()[0]}")
    except Exception:
        pass


def build_appimage() -> None:
    tool = shutil.which("appimagetool")
    if not tool:
        print(
            "!! appimagetool not found in PATH.\n"
            "   Download it once from https://github.com/AppImage/appimagetool/releases\n"
            "   (the x86_64 AppImage), chmod +x it, and put it on your PATH.",
            file=sys.stderr,
        )
        sys.exit(1)

    appdir = ROOT / "build" / "GRABBIT.AppDir"
    if appdir.exists():
        shutil.rmtree(appdir)
    (appdir / "usr" / "bin").mkdir(parents=True)

    print(">> Assembling AppDir…")
    # The whole onedir goes under usr/bin
    shutil.copytree(DIST, appdir / "usr" / "bin" / "GRABBIT", symlinks=True)

    # AppRun: entry point the AppImage executes
    apprun = appdir / "AppRun"
    apprun.write_text(
        '#!/bin/sh\n'
        'HERE="$(dirname "$(readlink -f "$0")")"\n'
        'exec "$HERE/usr/bin/GRABBIT/GRABBIT" "$@"\n'
    )
    apprun.chmod(0o755)

    # .desktop file (must be at AppDir root)
    (appdir / "grabbit.desktop").write_text(
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=GRABBIT\n"
        "Exec=GRABBIT\n"
        "Icon=grabbit\n"
        "Categories=AudioVideo;Utility;\n"
        "Terminal=false\n"
    )

    # Icon at AppDir root (name must match Icon= above)
    if ICON.exists():
        shutil.copy(ICON, appdir / "grabbit.png")
    else:
        print(f"   (warning: {ICON} missing — AppImage will have no icon)")

    out = ROOT / "dist" / "GRABBIT-x86_64.AppImage"
    print(">> Running appimagetool…")
    # APPIMAGE_EXTRACT_AND_RUN lets the appimagetool AppImage run without FUSE
    # (some systems lack libfuse2). ARCH is required by appimagetool.
    env = dict(os.environ, ARCH="x86_64", APPIMAGE_EXTRACT_AND_RUN="1")

    def _run(comp: str) -> None:
        cmd = [tool]
        if comp:
            cmd += ["--comp", comp]
        cmd += [str(appdir), str(out)]
        subprocess.run(cmd, check=True, env=env)

    try:
        _run(COMPRESSION)                       # xz → smallest AppImage
    except subprocess.CalledProcessError:
        if COMPRESSION:
            print(f"   '--comp {COMPRESSION}' rejected; retrying with default compression…")
            _run("")
        else:
            raise
    print(f">> AppImage ready: {out}  ({out.stat().st_size / 1_000_000:.0f} MB)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build GRABBIT (Linux).")
    ap.add_argument("--no-build", action="store_true", help="skip PyInstaller (prune existing dist)")
    ap.add_argument("--no-prune", action="store_true", help="keep the full Qt (no pruning)")
    ap.add_argument("--appimage", action="store_true", help="also produce an AppImage")
    args = ap.parse_args()

    if not args.no_build:
        run_pyinstaller()
    if not args.no_prune:
        prune()
    if args.appimage:
        build_appimage()
    print(">> Done.")


if __name__ == "__main__":
    main()
