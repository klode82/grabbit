# GRABBIT — PyInstaller spec (Linux, --onedir)
#
#   Build:   pyinstaller GRABBIT.spec --clean --noconfirm
#   Output:  dist/GRABBIT/                 (a self-contained folder)
#   Run:     ./dist/GRABBIT/GRABBIT
#
# This is the onedir build. The AppImage wrapping is a later step that takes
# this dist/GRABBIT/ folder as input.
#
# NOTE (Phase 11): FFmpeg is NOT bundled here — the app assumes a system
# ffmpeg for now. yt-dlp is a pip dependency and IS bundled (its extractors
# are collected below).

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# ── Bundled read-only resources ──────────────────────────────────────────────
# Mirrors app/core/paths.py: UI_DIR = <base>/app/ui, ASSETS_DIR = <base>/assets
datas = [
    ('app/ui', 'app/ui'),
    ('assets', 'assets'),
]
datas += collect_data_files('webview')   # pywebview backend data files

# ── Hidden imports — modules pulled in dynamically/lazily ─────────────────────
# uvicorn picks its loop/protocol implementations at runtime; pywebview loads
# its GUI backend by name; yt-dlp imports extractors dynamically — static
# analysis misses all of these, so collect them explicitly.
hiddenimports = []
hiddenimports += collect_submodules('uvicorn')
hiddenimports += collect_submodules('webview')
hiddenimports += collect_submodules('yt_dlp')
hiddenimports += collect_submodules('pydantic')
# NOTE: we deliberately do NOT collect_submodules('qtpy'). Doing so forced
# PyInstaller to analyse every qtpy.QtXxx submodule, each triggering its
# PySide6 hook and dragging in Qt3D / Charts / Multimedia / Quick3D / etc.
# The qtpy modules pywebview actually imports (QtWidgets, QtWebEngineWidgets,
# …) are still picked up via the collected 'webview' backend, so nothing is
# lost — only the unused Qt world is left out.
# Our Qt imports live inside functions (lazy), so name them explicitly.
# Listing QtWebEngineWidgets triggers PyInstaller's WebEngine hook, which
# bundles QtWebEngineProcess + its resources/locales.
hiddenimports += [
    'PySide6.QtCore',
    'PySide6.QtGui',
    'PySide6.QtWidgets',
    'PySide6.QtNetwork',
    'PySide6.QtWebEngineCore',
    'PySide6.QtWebEngineWidgets',
]

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Heavy Qt modules a WebEngine-based downloader never uses. Excluding
        # them keeps their hooks (and shared libraries) out of the bundle.
        # Conservative on purpose — anything WebEngine/pywebview might touch
        # (QtQuick, QtQml, QtWebChannel, QtPrintSupport, QtOpenGL, QtNetwork,
        # QtSvg) is left in for the hooks to decide.
        'PySide6.Qt3DCore', 'PySide6.Qt3DRender', 'PySide6.Qt3DInput',
        'PySide6.Qt3DLogic', 'PySide6.Qt3DAnimation', 'PySide6.Qt3DExtras',
        'PySide6.QtCharts', 'PySide6.QtDataVisualization',
        'PySide6.QtMultimedia', 'PySide6.QtMultimediaWidgets',
        'PySide6.QtQuick3D', 'PySide6.QtSql', 'PySide6.QtDesigner',
        'PySide6.QtHelp', 'PySide6.QtBluetooth', 'PySide6.QtNfc',
        'PySide6.QtPositioning', 'PySide6.QtSensors', 'PySide6.QtSerialPort',
        'PySide6.QtScxml', 'PySide6.QtRemoteObjects', 'PySide6.QtStateMachine',
        'PySide6.QtNetworkAuth', 'PySide6.QtTest',
        'qtpy.tests', 'tkinter',
    ],
    noarchive=False,
)

# Trim Qt WebEngine locale .pak files down to the languages GRABBIT supports.
# These ship for ~40 languages (1–3 MB each); we keep only the seven we use.
# en-US is kept as WebEngine's fallback, so dropping the rest is safe — a
# missing locale just falls back to en-US.
from pathlib import Path as _P
_KEEP_WE_LOCALES = {"en-US", "it", "de", "es", "fr", "pt-BR", "pt-PT"}


def _keep_datum(dest: str) -> bool:
    parts = _P(dest).parts
    if "qtwebengine_locales" in parts:
        return _P(dest).stem in _KEEP_WE_LOCALES
    return True


a.datas = [d for d in a.datas if _keep_datum(d[1])]

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,            # onedir: binaries are placed by COLLECT
    name='GRABBIT',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,                        # UPX can corrupt Qt/WebEngine libraries
    console=True,                     # TEMP: shows tracebacks while packaging.
                                      # Set to False for the release build.
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='assets/icon.png',           # used by the Win/macOS specs later; ignored on Linux
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='GRABBIT',
)
