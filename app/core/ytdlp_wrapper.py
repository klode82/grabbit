from __future__ import annotations

import re
from typing import Any, Callable, Optional

import yt_dlp


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _fmt_size(b: Optional[int]) -> Optional[str]:
    if b is None:
        return None
    for unit in ("B", "KB", "MB", "GB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} TB"


def _quality_label(fmt: dict) -> str:
    h = fmt.get("height")
    if h:
        return f"{h}p"
    w = fmt.get("width")
    if w:
        return f"{w}w"
    return fmt.get("format_note") or fmt.get("format_id") or "?"


# ─────────────────────────────────────────────────────────────────────────────
# Main wrapper
# ─────────────────────────────────────────────────────────────────────────────

class YTDLPWrapper:
    """Thin wrapper around yt-dlp for GRABBIT.

    All methods are synchronous — run them in a thread executor from async
    code (see api/routes.py).
    """

    # ── Analysis ─────────────────────────────────────────────────────────────

    def analyze(self, url: str) -> dict:
        """Extract full metadata for *url* without downloading anything."""
        opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": "discard_in_playlist",
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            # sanitize for JSON serialisation
            info = ydl.sanitize_info(info)

        entry_type = info.get("_type", "video")

        if entry_type == "playlist":
            return self._parse_playlist(info)
        return self._parse_video(info)

    def analyze_playlist_entry(self, url: str) -> dict:
        """Fully analyse a single video URL that was part of a playlist."""
        return self.analyze(url)

    # ── Parsing ──────────────────────────────────────────────────────────────

    def _parse_video(self, info: dict) -> dict:
        raw_formats = info.get("formats") or []

        video_formats: list[dict] = []
        audio_formats: list[dict] = []

        for f in raw_formats:
            vcodec = f.get("vcodec") or "none"
            acodec = f.get("acodec") or "none"

            base = {
                "format_id": f.get("format_id"),
                "ext": f.get("ext"),
                "filesize": f.get("filesize") or f.get("filesize_approx"),
                "filesize_human": _fmt_size(f.get("filesize") or f.get("filesize_approx")),
                "protocol": f.get("protocol"),
            }

            if vcodec != "none":
                video_formats.append({
                    **base,
                    "height": f.get("height"),
                    "width": f.get("width"),
                    "fps": f.get("fps"),
                    "vcodec": vcodec,
                    "acodec": acodec,
                    "tbr": f.get("tbr"),
                    "quality_label": _quality_label(f),
                    "combined": acodec != "none",   # True = video+audio in one stream
                })
            elif acodec != "none":
                audio_formats.append({
                    **base,
                    "acodec": acodec,
                    "abr": f.get("abr"),
                    "asr": f.get("asr"),
                    "language": f.get("language"),
                    "language_preference": f.get("language_preference", 0),
                    "quality_label": (
                        f"{int(f['abr'])}kbps" if f.get("abr") else acodec
                    ),
                })

        # Sort: highest quality first
        video_formats.sort(key=lambda x: (x.get("height") or 0), reverse=True)
        audio_formats.sort(key=lambda x: (x.get("abr") or 0), reverse=True)

        subtitles = self._parse_subtitles(info)
        has_subs = bool(subtitles["manual"] or subtitles["automatic"])

        return {
            "type": "video",
            "id": info.get("id"),
            "title": info.get("title"),
            "duration": info.get("duration"),          # seconds
            "duration_string": info.get("duration_string"),
            "thumbnail": info.get("thumbnail"),
            "uploader": info.get("uploader") or info.get("channel"),
            "webpage_url": info.get("webpage_url"),
            "extractor": info.get("extractor_key") or info.get("extractor"),
            "video_formats": video_formats,
            "audio_formats": audio_formats,
            "subtitles": subtitles,
            "has_subtitles": has_subs,
            "best_video": video_formats[0] if video_formats else None,
            "best_audio": audio_formats[0] if audio_formats else None,
            "format_count": {
                "video": len(video_formats),
                "audio": len(audio_formats),
            },
        }

    def _parse_playlist(self, info: dict) -> dict:
        entries = info.get("entries") or []
        # entries are stubs at this point (extract_flat)
        stubs = []
        for e in entries:
            if e is None:
                continue
            stubs.append({
                "id": e.get("id"),
                "title": e.get("title") or e.get("id"),
                "url": e.get("url") or e.get("webpage_url"),
                "duration": e.get("duration"),
                "thumbnail": e.get("thumbnail"),
            })

        return {
            "type": "playlist",
            "id": info.get("id"),
            "title": info.get("title"),
            "uploader": info.get("uploader") or info.get("channel"),
            "webpage_url": info.get("webpage_url"),
            "extractor": info.get("extractor_key") or info.get("extractor"),
            "count": len(stubs),
            "entries": stubs,
        }

    def _parse_subtitles(self, info: dict) -> dict:
        result: dict[str, dict] = {"manual": {}, "automatic": {}}

        for lang, subs in (info.get("subtitles") or {}).items():
            if subs:
                result["manual"][lang] = [s.get("ext") for s in subs if s.get("ext")]

        for lang, subs in (info.get("automatic_captions") or {}).items():
            if subs:
                result["automatic"][lang] = [s.get("ext") for s in subs if s.get("ext")]

        return result

    # ── Download ─────────────────────────────────────────────────────────────

    def download(
        self,
        url: str,
        options: dict,
        progress_callback: Optional[Callable[[dict], None]] = None,
    ) -> None:
        """Download *url* with *options*. Blocks until complete.

        ``options`` keys (all optional):
          - format_video   : yt-dlp format_id for video stream
          - format_audio   : yt-dlp format_id for audio stream
          - subtitle_lang  : language code, e.g. "en"
          - subtitle_auto  : bool — include auto-generated captions
          - output_dir     : destination folder
          - output_template: yt-dlp outtmpl (overrides output_dir)
          - rate_limit     : e.g. "1M"
          - embed_subs     : bool
        """

        def _hook(d: dict) -> None:
            if not progress_callback:
                return
            status = d.get("status")
            if status == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes") or 0
                percent = (downloaded / total * 100) if total else 0
                progress_callback({
                    "status": "downloading",
                    "percent": round(percent, 1),
                    "downloaded": downloaded,
                    "total": total,
                    "speed": d.get("_speed_str", ""),
                    "eta": d.get("_eta_str", ""),
                    "filename": d.get("filename", ""),
                })
            elif status == "finished":
                progress_callback({
                    "status": "finished",
                    "filename": d.get("filename", ""),
                })
            elif status == "error":
                progress_callback({"status": "error"})

        # Build format selector
        fmt_video = options.get("format_video", "")
        fmt_audio = options.get("format_audio", "")

        if fmt_video and fmt_audio:
            fmt_selector = f"{fmt_video}+{fmt_audio}/bestvideo+bestaudio/best"
        elif fmt_video:
            fmt_selector = f"{fmt_video}/bestvideo+bestaudio/best"
        else:
            fmt_selector = "bestvideo+bestaudio/best"

        output_dir = options.get("output_dir", ".")
        tpl = options.get("output_template") or f"{output_dir}/%(title)s.%(ext)s"

        ydl_opts: dict[str, Any] = {
            "format": fmt_selector,
            "outtmpl": tpl,
            "progress_hooks": [_hook],
            "quiet": True,
            "no_warnings": True,
            "merge_output_format": "mp4",
        }

        sub_lang = options.get("subtitle_lang")
        if sub_lang:
            ydl_opts["writesubtitles"] = True
            ydl_opts["subtitleslangs"] = [sub_lang]
            if options.get("subtitle_auto"):
                ydl_opts["writeautomaticsub"] = True
            if options.get("embed_subs"):
                ydl_opts["embedsubtitles"] = True

        rate = options.get("rate_limit")
        if rate:
            ydl_opts["ratelimit"] = rate

        cookies = options.get("cookies_file")
        if cookies:
            ydl_opts["cookiefile"] = cookies

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
