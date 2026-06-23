from __future__ import annotations

import json
import os
import threading
import uuid
from enum import Enum
from pathlib import Path
from typing import Callable, Dict, List, Optional


class Status(str, Enum):
    PENDING     = "pending"
    DOWNLOADING = "downloading"
    PAUSED      = "paused"
    COMPLETED   = "completed"
    ERROR       = "error"
    CANCELLED   = "cancelled"


class DownloadItem:
    def __init__(self, url: str, title: str, options: dict) -> None:
        self.id: str = str(uuid.uuid4())
        self.url: str = url
        self.title: str = title
        self.thumbnail: Optional[str] = options.pop("thumbnail", None)
        self.options: dict = options
        self.status: Status = Status.PENDING
        self.progress: float = 0.0
        self.speed: str = ""
        self.eta: str = ""
        self.filename: str = ""
        self.error: Optional[str] = None
        # Signals the download thread to stop (used for pause and cancel)
        self._stop_event: threading.Event = threading.Event()

    def to_dict(self) -> dict:
        return {
            "id":        self.id,
            "url":       self.url,
            "title":     self.title,
            "thumbnail": self.thumbnail,
            "status":    self.status,
            "progress":  self.progress,
            "speed":     self.speed,
            "eta":       self.eta,
            "filename":  self.filename,
            "error":     self.error,
        }


class DownloadQueue:
    """Thread-safe download queue with pause, resume, and cancel support."""

    def __init__(self, max_concurrent: int = 2) -> None:
        self._items: Dict[str, DownloadItem] = {}
        self._order: List[str] = []
        self._lock = threading.Lock()
        self.max_concurrent = max_concurrent
        self.is_paused: bool = False
        self.auto_start: bool = True   # updated from settings at startup
        self._listeners: List[Callable[[dict], None]] = []

        # Persistence path — same directory as settings.json
        if os.name == "nt":
            base = Path(os.environ.get("APPDATA", Path.home()))
        else:
            base = Path.home() / ".config"
        self._queue_path: Path = base / "grabbit" / "queue.json"

        self._load_queue()   # restore previous session
        # NOTE: _schedule() is NOT called here intentionally.
        # It is triggered from routes.py once the WS listener is registered
        # and auto_start_downloads has been read from settings.

    # ── Persistence ───────────────────────────────────────────────────────────

    def _save_queue(self) -> None:
        """Write the current queue to disk. Called on every significant change."""
        try:
            self._queue_path.parent.mkdir(parents=True, exist_ok=True)
            with self._lock:
                payload = {
                    "version": 1,
                    "order":   list(self._order),
                    "items": {
                        iid: {
                            "id":        item.id,
                            "url":       item.url,
                            "title":     item.title,
                            "thumbnail": item.thumbnail,
                            "status":    item.status,
                            "progress":  item.progress,
                            "error":     item.error,
                            "filename":  item.filename,
                            "options":   item.options,
                        }
                        for iid, item in self._items.items()
                        if item.status != Status.CANCELLED
                    },
                }
            self._queue_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except Exception as exc:
            from app.core.logger import log
            log.warning("Could not save queue: %s", exc)

    def _load_queue(self) -> None:
        """Restore the queue from disk on startup."""
        if not self._queue_path.exists():
            return
        try:
            data = json.loads(self._queue_path.read_text(encoding="utf-8"))
            if data.get("version") != 1:
                return
            for iid in data.get("order", []):
                raw = data.get("items", {}).get(iid)
                if not raw:
                    continue
                opts = dict(raw.get("options") or {})
                opts["thumbnail"] = raw.get("thumbnail")
                item = DownloadItem(raw["url"], raw["title"], opts)
                item.id       = raw["id"]
                item.error    = raw.get("error")
                item.filename = raw.get("filename", "")
                # Interrupted downloads restart from PENDING; PAUSED stays PAUSED
                # so the user's explicit pause choice is respected on restart.
                status = raw.get("status", Status.PENDING)
                if status == Status.DOWNLOADING:
                    status = Status.PENDING
                item.status   = status
                # Preserve progress only for completed items (cosmetic)
                item.progress = raw.get("progress", 0.0) if status == Status.COMPLETED else 0.0
                self._items[item.id] = item
                self._order.append(item.id)
        except Exception as exc:
            from app.core.logger import log
            log.warning("Could not load queue: %s", exc)

    def add_listener(self, callback: Callable[[dict], None]) -> None:
        """Register a callback that receives every queue event."""
        self._listeners.append(callback)

    # ── Item lifecycle ─────────────────────────────────────────────────────────

    def add(self, url: str, title: str, options: dict) -> DownloadItem:
        """Add an item to the queue and optionally start it immediately."""
        item = DownloadItem(url, title, options)
        with self._lock:
            self._items[item.id] = item
            self._order.append(item.id)
        self._emit_item("added", item)
        if self.auto_start:
            self._schedule()
        self._save_queue()
        return item

    def cancel(self, item_id: str) -> bool:
        """Mark an item as CANCELLED (keeps it in the list for visibility)."""
        cancelled_item = None
        with self._lock:
            item = self._items.get(item_id)
            if item and item.status in (Status.PENDING, Status.PAUSED,
                                        Status.DOWNLOADING):
                item.status = Status.CANCELLED
                item._stop_event.set()
                cancelled_item = item
        if cancelled_item:
            self._emit_item("status", cancelled_item)
            self._save_queue()
            return True
        return False

    def remove(self, item_id: str) -> bool:
        """Remove an item from the list entirely (stop thread if active)."""
        with self._lock:
            item = self._items.get(item_id)
            if not item:
                return False
            item._stop_event.set()
            del self._items[item_id]
            self._order = [i for i in self._order if i != item_id]
        self._emit_stats()
        self._save_queue()
        return True

    def pause(self, item_id: str) -> bool:
        """Interrupt an active download and mark it PAUSED."""
        paused_item = None
        with self._lock:
            item = self._items.get(item_id)
            if item and item.status == Status.DOWNLOADING:
                item.status = Status.PAUSED
                item._stop_event.set()
                paused_item = item
        if paused_item:
            self._emit_item("status", paused_item)
            self._save_queue()
            return True
        return False

    def resume(self, item_id: str) -> bool:
        """Resume a PAUSED item (yt-dlp will use continuedl to carry on)."""
        resumed_item = None
        with self._lock:
            item = self._items.get(item_id)
            if item and item.status == Status.PAUSED:
                item._stop_event.clear()
                item.options["continuedl"] = True
                item.status = Status.PENDING
                resumed_item = item
        if resumed_item:
            self._emit_item("status", resumed_item)
            self._save_queue()
        self._schedule()
        return True

    def restart(self, item_id: str) -> bool:
        """Restart a CANCELLED or ERROR item from the beginning."""
        restarted_item = None
        with self._lock:
            item = self._items.get(item_id)
            if item and item.status in (Status.CANCELLED, Status.ERROR):
                item._stop_event.clear()
                item.options.pop("continuedl", None)
                item.status   = Status.PENDING
                item.progress = 0.0
                item.error    = None
                restarted_item = item
        if restarted_item:
            self._emit_item("status", restarted_item)
            self._save_queue()
        self._schedule()
        return restarted_item is not None

    # ── Global queue controls ──────────────────────────────────────────────────

    def pause_all(self) -> None:
        """Prevent new downloads from starting and pause all active ones."""
        self.is_paused = True
        with self._lock:
            active = [i for i in self._items.values()
                      if i.status == Status.DOWNLOADING]
        for item in active:
            self.pause(item.id)
        self._save_queue()

    def resume_all(self) -> None:
        """Resume the whole queue: un-pause any PAUSED items and start any
        PENDING ones (e.g. items added while auto-start was off)."""
        self.is_paused = False
        with self._lock:
            paused = [i for i in self._items.values()
                      if i.status == Status.PAUSED]
        for item in paused:
            self.resume(item.id)
        # Kick the scheduler unconditionally: when nothing was PAUSED (the
        # auto-start-off case), the loop above starts nothing, so PENDING items
        # would otherwise never run.
        self._schedule()

    def clear_completed(self) -> int:
        """Remove all COMPLETED items. Returns the number removed."""
        with self._lock:
            ids = [i.id for i in self._items.values()
                   if i.status == Status.COMPLETED]
            for iid in ids:
                del self._items[iid]
            self._order = [o for o in self._order if o not in ids]
        self._emit_queue_update()
        self._save_queue()
        return len(ids)

    def clear_all(self) -> None:
        """Cancel and remove every item. Also resets the paused flag."""
        with self._lock:
            for item in self._items.values():
                item._stop_event.set()
                item.status = Status.CANCELLED
            self._items.clear()
            self._order.clear()
        self.is_paused = False
        self._emit_queue_update()
        self._save_queue()

    def get_all(self) -> List[dict]:
        with self._lock:
            return [self._items[i].to_dict()
                    for i in self._order if i in self._items]

    @property
    def stats(self) -> dict:
        with self._lock:
            items = list(self._items.values())
        return {
            "total":     len(items),
            "pending":   sum(1 for i in items if i.status == Status.PENDING),
            "active":    sum(1 for i in items if i.status == Status.DOWNLOADING),
            "paused":    sum(1 for i in items if i.status == Status.PAUSED),
            "completed": sum(1 for i in items if i.status == Status.COMPLETED),
            "error":     sum(1 for i in items if i.status == Status.ERROR),
            "is_paused": self.is_paused,
        }

    # ── Scheduling ─────────────────────────────────────────────────────────────

    def _schedule(self) -> None:
        if self.is_paused:
            return
        to_start: List[DownloadItem] = []
        with self._lock:
            active = sum(1 for i in self._items.values()
                         if i.status == Status.DOWNLOADING)
            slots = self.max_concurrent - active
            if slots <= 0:
                return
            for item_id in self._order:
                if slots <= 0:
                    break
                item = self._items.get(item_id)
                if item and item.status == Status.PENDING:
                    # Mark DOWNLOADING inside the lock — prevents two concurrent
                    # _schedule() calls from both picking up the same item.
                    item.status = Status.DOWNLOADING
                    to_start.append(item)
                    slots -= 1

        for item in to_start:
            t = threading.Thread(
                target=self._run, args=(item,),
                daemon=True, name=f"dl-{item.id[:8]}"
            )
            t.start()

    def _run(self, item: DownloadItem) -> None:
        from app.core.ytdlp_wrapper import YTDLPWrapper, _DownloadInterrupted

        wrapper = YTDLPWrapper()

        # _schedule() already set status=DOWNLOADING inside the lock.
        # If status changed between then and now (cancel/remove), bail out.
        with self._lock:
            if item.status != Status.DOWNLOADING:
                return

        self._emit_item("status", item)

        def on_progress(data: dict) -> None:
            if data["status"] == "downloading":
                with self._lock:
                    item.progress = data.get("percent", 0.0)
                    item.speed    = data.get("speed", "")
                    item.eta      = data.get("eta", "")
                    item.filename = data.get("filename", "")
                self._emit_item("progress", item)
            elif data["status"] == "finished":
                with self._lock:
                    item.progress = 100.0
                    item.filename = data.get("filename", "")

        try:
            final_path = wrapper.download(
                item.url, item.options,
                progress_callback=on_progress,
                stop_event=item._stop_event,
            )
            with self._lock:
                # Only mark COMPLETED if no external state change happened
                if item.status not in (Status.PAUSED, Status.CANCELLED):
                    item.status   = Status.COMPLETED
                    item.progress = 100.0
                    if final_path:
                        item.filename = final_path
            self._emit_item("status", item)
            self._save_queue()
        except _DownloadInterrupted:
            from app.core.ytdlp_wrapper import _cleanup_partial_files
            _cleanup_partial_files(item.options.get("output_dir", "."))
        except Exception as exc:
            with self._lock:
                if item.status not in (Status.PAUSED, Status.CANCELLED):
                    item.status = Status.ERROR
                    item.error  = str(exc)
            self._emit_item("status", item)
            self._save_queue()
        finally:
            self._schedule()

    # ── Event helpers ──────────────────────────────────────────────────────────

    def _emit_item(self, event: str, item: DownloadItem) -> None:
        """Broadcast an event about a single item.

        Skips silently if the item has already been removed from the queue
        (e.g. by clear_all() while the download thread was still running).
        """
        with self._lock:
            if item.id not in self._items:
                return   # item removed — don't send a ghost update to the UI
        payload = {"event": event, "item": item.to_dict(), "stats": self.stats}
        for cb in self._listeners:
            try:
                cb(payload)
            except Exception:
                pass

    def _emit_stats(self) -> None:
        """Broadcast current stats only (no item data)."""
        payload = {"event": "stats", "stats": self.stats}
        for cb in self._listeners:
            try:
                cb(payload)
            except Exception:
                pass

    def _emit_queue_update(self) -> None:
        """Broadcast full queue state (used after bulk operations)."""
        payload = {"event": "queue_update",
                   "items": self.get_all(), "stats": self.stats}
        for cb in self._listeners:
            try:
                cb(payload)
            except Exception:
                pass


# Singleton — shared across the whole app
queue = DownloadQueue(max_concurrent=2)
