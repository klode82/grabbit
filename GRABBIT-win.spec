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
    binaries=[],
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
    console=True,        # TEMP: keep the console to read errors. Set to False for the release build.
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # icon='assets/icon.ico',   # add once you have an .ico (see notes)
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
