from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


_DEFAULTS: dict[str, Any] = {
    "language": "en",                   # UI language
    "theme": "dark",                    # "dark" | "light"
    "output_dir": str(Path.home() / "Downloads" / "GRABBIT"),
    "max_concurrent": 2,
    # Video
    "default_video_quality": "best",    # "best"|"2160"|"1440"|"1080"|"720"|"576"|"480"|"360"
    "default_video_ext": "mp4",         # "mp4"|"webm"|"mkv"
    # Audio
    "default_audio_quality": "best",    # "best"|"320"|"256"|"192"|"128"|"96"
    "default_audio_ext": "m4a",         # "m4a"|"mp3"|"opus"|"flac"|"wav"
    "default_audio_lang": "",           # ISO 639-1, empty = any
    # Subtitles
    "default_sub_lang": "",             # ISO 639-1, empty = none
    "default_sub_auto": False,          # include auto-generated captions
    "embed_subs": False,                # embed subs in container
    # Network
    "rate_limit": "",                   # e.g. "1M", empty = unlimited
    "cookies_file": "",                 # path to Netscape cookies file
    "proxy": "",                        # e.g. "socks5://127.0.0.1:1080"
}


def _config_path() -> Path:
    xdg = os.environ.get("XDG_CONFIG_HOME")
    if xdg:
        base = Path(xdg)
    elif os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home()))
    else:
        base = Path.home() / ".config"
    p = base / "grabbit" / "settings.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


class SettingsManager:
    def __init__(self) -> None:
        self._path = _config_path()
        self._data: dict[str, Any] = {}
        self._load()

    # ── Public API ────────────────────────────────────────────────────────────

    def get_all(self) -> dict:
        return dict(self._data)

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def update(self, patch: dict) -> dict:
        # Only allow known keys
        for k, v in patch.items():
            if k in _DEFAULTS:
                self._data[k] = v
        self._save()
        self._ensure_output_dir()
        return self.get_all()

    def reset(self) -> dict:
        self._data = dict(_DEFAULTS)
        self._save()
        self._ensure_output_dir()
        return self.get_all()

    # ── I/O ──────────────────────────────────────────────────────────────────

    def _load(self) -> None:
        self._data = dict(_DEFAULTS)
        if self._path.exists():
            try:
                stored = json.loads(self._path.read_text(encoding="utf-8"))
                for k, v in stored.items():
                    if k in _DEFAULTS:
                        self._data[k] = v
            except (json.JSONDecodeError, OSError):
                pass
        # Ensure the download directory exists so yt-dlp never fails on a
        # missing destination folder, even on a fresh install.
        self._ensure_output_dir()

    def _ensure_output_dir(self) -> None:
        """Create the configured output directory if it does not exist."""
        try:
            Path(self._data.get("output_dir", ".")).expanduser().mkdir(
                parents=True, exist_ok=True
            )
        except OSError:
            pass

    def _save(self) -> None:
        try:
            self._path.write_text(
                json.dumps(self._data, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError:
            pass


# Singleton
settings = SettingsManager()
