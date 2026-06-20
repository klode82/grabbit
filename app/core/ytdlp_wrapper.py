from __future__ import annotations

import re
import threading
from pathlib import Path
from typing import Any, Callable, Optional

import yt_dlp

from app.core.logger import log

# yt-dlp injects ANSI colour codes into _speed_str / _eta_str; strip them
# before sending to the frontend so the UI sees plain text.
_ANSI_RE = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]')


def _strip_ansi(s: str) -> str:
    return _ANSI_RE.sub('', s or '')


class _DownloadInterrupted(BaseException):
    """Raised inside the yt-dlp progress hook to interrupt a download.

    Inherits from BaseException (not Exception) so it passes through
    yt-dlp's internal ``except Exception`` handlers and propagates out
    of ``ydl.download()``, stopping the transfer cleanly.
    """


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


def _simplify_codec(codec: str) -> str:
    """Return a short, human-readable codec identifier.

    Strips the profile/level suffix (e.g. 'avc1.640028' → 'avc1').
    """
    if not codec or codec.lower() in ("none", ""):
        return ""
    c = codec.lower().split(".")[0]
    MAP = {
        "avc1": "avc1", "h264": "avc1",
        "av01": "av1",  "av1":  "av1",
        "vp9":  "vp9",  "vp09": "vp9",
        "vp8":  "vp8",  "vp08": "vp8",
        "hvc1": "hevc", "hev1": "hevc", "hevc": "hevc", "h265": "hevc",
        "mp4a": "aac",  "aac":  "aac",
        "opus": "opus",
        "vorbis": "vorbis",
        "mp3":  "mp3",
        "flac": "flac",
        "ec-3": "ac3",  "ac-3": "ac3",  "eac3": "ac3",
        "dtse": "dts",  "dtsc": "dts",
    }
    return MAP.get(c, c[:6])   # known → friendly name, unknown → first 6 chars


def _find_output_file(output_dir: str, merge_ext: str = "mp4") -> str:
    """Return the path of the most recently modified file in *output_dir*.

    For video+audio merges, matches ``*.{merge_ext}``.
    For audio-only downloads (merge_ext may be empty / irrelevant), falls back
    to the newest file of any extension modified in the last 5 minutes.
    """
    try:
        d = Path(output_dir).expanduser()

        # Try the primary merge extension first
        if merge_ext:
            files = sorted(
                d.glob(f"*.{merge_ext}"),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
            if files:
                return str(files[0])

        # Fallback: newest non-temp file modified in the last 300 seconds
        import time
        cutoff = time.time() - 300
        candidates = [
            f for f in d.iterdir()
            if f.is_file()
            and f.stat().st_mtime >= cutoff
            and not f.name.startswith(".")
            and not f.suffix in (".ytdl", ".part")
        ]
        if candidates:
            return str(max(candidates, key=lambda f: f.stat().st_mtime))

    except Exception as exc:
        log.warning("_find_output_file failed for '%s': %s", output_dir, exc)
    return ""


def _cleanup_partial_files(output_dir: str) -> None:
    """Remove temp files left by an interrupted yt-dlp download.

    Covers:
    - ``*.part``  — partially downloaded stream
    - ``*.ytdl``  — yt-dlp download descriptor
    - ``*.f<N>.*`` — completed individual stream (e.g. ``title.f137.mp4``,
                     ``title.f140.m4a``) that would have been merged had the
                     download not been interrupted
    """
    import time, re
    _fmt_re = re.compile(r'\.f\d+\.')   # matches .f137. .f140. etc.
    try:
        d = Path(output_dir).expanduser()
        cutoff = time.time() - 300
        removed: list[str] = []
        for f in d.iterdir():
            if not f.is_file() or f.stat().st_mtime < cutoff:
                continue
            if f.suffix in (".part", ".ytdl") or _fmt_re.search(f.name):
                f.unlink(missing_ok=True)
                removed.append(f.name)
        if removed:
            log.info("Cleaned up partial files: %s", removed)
    except Exception as exc:
        log.warning("Partial file cleanup failed for '%s': %s", output_dir, exc)


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
        log.info("Analyzing URL: %s", url)
        opts: dict[str, Any] = {
            "quiet":             True,
            "no_warnings":       True,
            "extract_flat":      "discard_in_playlist",
            # Skip unavailable / private / geo-blocked entries in playlists
            # instead of raising an error for the whole playlist.
            "ignoreerrors":      True,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            info = ydl.sanitize_info(info)

        entry_type = info.get("_type", "video")
        log.info("Analysis complete — type=%s title=%s", entry_type, info.get("title"))

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
                    "height":        f.get("height"),
                    "width":         f.get("width"),
                    "fps":           f.get("fps"),
                    "vcodec":        vcodec,
                    "acodec":        acodec,
                    "codec":         _simplify_codec(vcodec),   # human-readable
                    "tbr":           f.get("tbr"),
                    "quality_label": _quality_label(f),
                    "combined":      acodec != "none",
                })
            elif acodec != "none":
                audio_formats.append({
                    **base,
                    "acodec":   acodec,
                    "codec":    _simplify_codec(acodec),        # human-readable
                    "abr":      f.get("abr"),
                    "asr":      f.get("asr"),
                    "language": f.get("language"),
                    "language_preference": f.get("language_preference", 0),
                    "quality_label": (
                        f"{int(f['abr'])}k" if f.get("abr") else _simplify_codec(acodec)
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
        stop_event: Optional[threading.Event] = None,
    ) -> str:
        """Download *url* with *options*. Blocks until complete.

        Returns the path of the final output file, or an empty string on failure.
        If *stop_event* is set during the download, raises ``_DownloadInterrupted``
        (a BaseException subclass) so the caller can handle pause/cancel cleanly.
        """

        # Bail out immediately if already interrupted before the download starts.
        # This avoids wasting time on the metadata peek for cancelled items.
        if stop_event and stop_event.is_set():
            raise _DownloadInterrupted("Download cancelled before start")

        def _hook(d: dict) -> None:
            # Check for pause/cancel between every progress update.
            # _DownloadInterrupted is a BaseException — it passes through
            # yt-dlp's own try/except Exception handlers.
            if stop_event and stop_event.is_set():
                raise _DownloadInterrupted("Download interrupted by user")
            if not progress_callback:
                return
            status = d.get("status")
            if status == "downloading":
                total      = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes") or 0
                percent    = (downloaded / total * 100) if total else 0
                progress_callback({
                    "status":    "downloading",
                    "percent":   round(percent, 1),
                    "downloaded": downloaded,
                    "total":     total,
                    "speed":     _strip_ansi(d.get("_speed_str", "")),
                    "eta":       _strip_ansi(d.get("_eta_str", "")),
                    "filename":  d.get("filename", ""),
                })
            elif status == "finished":
                log.info("Download stream finished: %s", d.get("filename", ""))
                progress_callback({
                    "status":   "finished",
                    "filename": d.get("filename", ""),
                })
            elif status == "error":
                log.error("yt-dlp hook reported error for: %s", url)
                progress_callback({"status": "error"})

        # ── Format selector ───────────────────────────────────────────────────
        fmt_video = options.get("format_video", "")
        fmt_audio = options.get("format_audio", "")

        if fmt_video and fmt_audio:
            fmt_selector = f"{fmt_video}+{fmt_audio}/bestvideo+bestaudio/best"
        elif fmt_video:
            # Video only — no audio track
            fmt_selector = f"{fmt_video}/bestvideo/best"
        elif fmt_audio:
            # Audio only — no video track
            fmt_selector = f"{fmt_audio}/bestaudio/best"
        else:
            fmt_selector = "bestvideo+bestaudio/best"

        output_dir = options.get("output_dir", ".")
        merge_ext  = options.get("merge_output_format", "mp4")

        Path(output_dir).expanduser().mkdir(parents=True, exist_ok=True)

        base_tpl = options.get("output_template") or f"{output_dir}/%(title)s.%(ext)s"

        # ── Counter-safe filename ─────────────────────────────────────────────
        # Ask yt-dlp for the exact filename it would use, then add _01/_02/…
        # if that file already exists.  This avoids sanitisation mismatches
        # between our own string processing and yt-dlp's internal logic.
        actual_tpl   = base_tpl
        use_overwrite = False
        try:
            peek_opts: dict[str, Any] = {
                "quiet": True,
                "no_warnings": True,
                "outtmpl": base_tpl,
            }
            with yt_dlp.YoutubeDL(peek_opts) as ydl_peek:
                peek_info = ydl_peek.extract_info(url, download=False)
                peek_info = ydl_peek.sanitize_info(peek_info)
                raw_name  = ydl_peek.prepare_filename(peek_info)

            base_path = Path(raw_name).with_suffix(f".{merge_ext}")
            if base_path.exists():
                counter = 1
                while True:
                    candidate = (base_path.parent /
                                 f"{base_path.stem}_{counter:02d}.{merge_ext}")
                    if not candidate.exists():
                        actual_tpl = str(
                            candidate.parent / f"{candidate.stem}.%(ext)s"
                        )
                        log.info(
                            "File '%s' exists — saving as '%s'",
                            base_path.name, candidate.name,
                        )
                        break
                    counter += 1
        except Exception as exc:
            log.warning(
                "Could not peek output filename (%s) — will overwrite if exists", exc
            )
            use_overwrite = True

        log.info("Starting download: url=%s format=%s output=%s",
                 url, fmt_selector, actual_tpl)

        ydl_opts: dict[str, Any] = {
            "format":               fmt_selector,
            "outtmpl":              actual_tpl,
            "progress_hooks":       [_hook],
            "quiet":                True,
            "no_warnings":          True,
            "merge_output_format":  merge_ext,
        }
        if use_overwrite:
            ydl_opts["overwrites"] = True

        # Audio-only downloads don't need merging — drop the key so yt-dlp
        # just extracts the audio container as-is.
        if fmt_audio and not fmt_video:
            ydl_opts.pop("merge_output_format", None)

        if options.get("continuedl"):
            ydl_opts["continuedl"] = True

        sub_lang = options.get("subtitle_lang")
        if sub_lang:
            ydl_opts["writesubtitles"]           = True
            ydl_opts["subtitleslangs"]            = [sub_lang]
            ydl_opts["sleep_interval_subtitles"]  = 1
            if options.get("subtitle_auto"):
                ydl_opts["writeautomaticsub"] = True

            pps     = ydl_opts.setdefault("postprocessors", [])
            sub_fmt = options.get("subtitle_format", "vtt")

            # Step 1 — convert format (must happen BEFORE embed)
            if sub_fmt and sub_fmt != "vtt":
                pps.append({
                    "key":    "FFmpegSubtitlesConvertor",
                    "format": sub_fmt,
                })

            # Step 2 — embed into container (after conversion)
            # Added to the explicit list so it runs AFTER the convertor.
            # Do NOT also set ydl_opts["embedsubtitles"] = True: that would
            # let yt-dlp insert a second FFmpegEmbedSubtitlePP *before* ours.
            if options.get("embed_subs"):
                pps.append({"key": "FFmpegEmbedSubtitle"})

        if options.get("rate_limit"):
            ydl_opts["ratelimit"] = options["rate_limit"]

        if options.get("cookies_file"):
            ydl_opts["cookiefile"] = options["cookies_file"]

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        final_path = _find_output_file(output_dir, merge_ext)
        log.info("Final output file: %s", final_path or "(not found)")
        return final_path
