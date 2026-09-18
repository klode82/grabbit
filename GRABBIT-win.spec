# -*- mode: python ; coding: utf-8 -*-
#
# Windows build spec for GRABBIT.
#
# On Windows pywebview uses the EdgeChromium (WebView2) backend via pythonnet —
# NOT Qt — so this spec is much simpler than the Linux one: no PySide6, no Qt
# pruning, no WebEngine locale filtering. yt-dlp is bundled, and certifi is
# included so HTTPS/SSL works in the frozen app (the CA bundle isn't found
# otherwise, which is what caused the CERTIFICATE_VERIFY_FAILED errors).
#
# Build:  pyinstaller GRABBIT-win.spec --clean --noconfirm
# Run:    dist\GRABBIT\GRABBIT.exe

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# ── Deno: the JS runtime yt-dlp needs for YouTube challenge solving ──────────
# Shipped as a pip wheel ([deno] extra), so it lands in the venv's scripts dir.
# Bundling it at the root of _internal/ puts it where app/core/ytdlp_wrapper.py
# looks (BASE_DIR == sys._MEIPASS). The solver scripts (yt_dlp_ejs) are picked
# up automatically by yt-dlp's own PyInstaller hook — nothing to do for those.
import os as _os, sysconfig as _sysconfig

_DENO = _os.path.join(_sysconfig.get_path('scripts'), 'deno.exe')
if not _os.path.isfile(_DENO):
    raise SystemExit(
        f"Build aborted: deno not found at {_DENO}.\n"
        "Install it into the build venv with:  pip install -r requirements.txt"
    )
binaries = [(_DENO, '.')]

hiddenimports = []
hiddenimports += collect_submodules('uvicorn')
hiddenimports += collect_submodules('webview')
hiddenimports += collect_submodules('yt_dlp')
hiddenimports += collect_submodules('pydantic')
hiddenimports += ['clr']          # pythonnet, used by the EdgeChromium backend

datas = []
datas += [('app/ui', 'app/ui'), ('assets', 'assets')]
datas += collect_data_files('webview')    # WebView2Loader.dll, Microsoft.Web.WebView2.Core.dll, …
datas += collect_data_files('certifi')     # CA bundle → fixes SSL in the frozen app

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['PySide6', 'PyQt6', 'PyQt5', 'tkinter'],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='GRABBIT',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,       # no terminal window; runtime errors still go to grabbit.log (%APPDATA%\grabbit\)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='assets/icon.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='GRABBIT',
)
