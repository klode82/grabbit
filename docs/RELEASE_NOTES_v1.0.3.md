## GRABBIT v1.0.3

### New features

- **Audio conversion** — optionally re-encode the downloaded audio track instead of keeping the source as-is, choosing between MP3, AAC, OGG (Vorbis), Opus, FLAC, or WAV, with a free bitrate setting.
  - When downloading video + audio, the video stream is copied untouched and only the audio track is recoded, staying inside the chosen container (MP4/MKV).
  - For audio-only downloads (or audio-only links), the output container follows the selected format automatically.
  - Set a global default in **Settings**, or override it per download (single video or entire playlist) via the new **Audio** button next to *Advanced*.
  - Note: with an **MP4** container, only MP3 and AAC are offered for conversion — the other formats require MKV for broad compatibility.

### Windows

- **App icon** — the packaged `.exe` now shows the GRABBIT icon instead of the generic Python one.
- **Maximize covering the taskbar** — the frameless window now resizes to the monitor's work area instead of using WinForms' native maximize, which ignored the taskbar.
- **Playlist accordions stuck after a second playlist** — the Video/Audio/Subtitles accordions in the global format bar stopped responding after analyzing a second playlist in the same session; fixed a duplicated click-handler bug.

### Bug fixes

- **Stale selection badges on a new video** — after analyzing a new video (or a second one in the same session), a badge from the previous video — most noticeably a subtitle language — could stay visible even though nothing was actually selected for the new link, so it silently wasn't downloaded despite looking active. Video, audio, and subtitle selections and their badges are now fully reset before applying the new video's own defaults.
- **Queue counters and badge out of sync after removing an item** — removing a single download from the queue updated the list but left the "Queue" tab badge and the Total/Completed counters showing stale numbers; if it was the last item, the list stayed blank instead of showing "No downloads yet". Removing an item now triggers the same full resync already used by "Clear completed" / "Clear all".
- **Ambiguous global audio/video picker on playlists with multiple language tracks** — the playlist-wide format picker grouped formats only by quality/codec, ignoring language. A video with two otherwise-identical tracks in different languages (e.g. an original-language track and an Italian dub, both AAC) collapsed into a single global option, silently keeping only one language per entry and applying it inconsistently across the playlist. Language is now part of the grouping, so each language variant appears as its own distinct, selectable option.

---

**Full Changelog**: https://github.com/klode82/grabbit/compare/v1.0.1...v1.0.3
