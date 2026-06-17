from __future__ import annotations

import threading
import uuid
from enum import Enum
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
        self.is_paused: bool = False          # global pause flag
        self._listeners: List[Callable[[dict], None]] = []

    # ── Listeners ─────────────────────────────────────────────────────────────

    def add_listener(self, callback: Callable[[dict], None]) -> None:
        """Register a callback that receives every queue event."""
        self._listeners.append(callback)

    # ── Item lifecycle ─────────────────────────────────────────────────────────

    def add(self, url: str, title: str, options: dict) -> DownloadItem:
        """Add an item to the queue and try to start it."""
        item = DownloadItem(url, title, options)
        with self._lock:
            self._items[item.id] = item
            self._order.append(item.id)
        self._emit_item("added", item)
        self._schedule()
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
        # Emit outside the lock so the event loop is never blocked
        if cancelled_item:
            self._emit_item("status", cancelled_item)
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
        # Emit outside the lock
        if paused_item:
            self._emit_item("status", paused_item)
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
        self._schedule()
        return True

    def restart(self, item_id: str) -> bool:
        """Restart a CANCELLED or ERROR item from the beginning."""
        restarted_item = None
        with self._lock:
            item = self._items.get(item_id)
            if item and item.status in (Status.CANCELLED, Status.ERROR):
                item._stop_event.clear()
                item.options.pop("continuedl", None)  # fresh start, no resume
                item.status   = Status.PENDING
                item.progress = 0.0
                item.error    = None
                restarted_item = item
        if restarted_item:
            self._emit_item("status", restarted_item)
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

    def resume_all(self) -> None:
        """Resume the whole queue."""
        self.is_paused = False
        with self._lock:
            paused = [i for i in self._items.values()
                      if i.status == Status.PAUSED]
        for item in paused:
            self.resume(item.id)

    def clear_completed(self) -> int:
        """Remove all COMPLETED items. Returns the number removed."""
        with self._lock:
            ids = [i.id for i in self._items.values()
                   if i.status == Status.COMPLETED]
            for iid in ids:
                del self._items[iid]
            self._order = [o for o in self._order if o not in ids]
        self._emit_queue_update()
        return len(ids)

    def clear_all(self) -> None:
        """Cancel and remove every item."""
        with self._lock:
            for item in self._items.values():
                item._stop_event.set()
                item.status = Status.CANCELLED
            self._items.clear()
            self._order.clear()
        self._emit_queue_update()

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
        with self._lock:
            active = sum(1 for i in self._items.values()
                         if i.status == Status.DOWNLOADING)
            slots = self.max_concurrent - active
            if slots <= 0:
                return
            pending = [self._items[i] for i in self._order
                       if i in self._items
                       and self._items[i].status == Status.PENDING]
        for item in pending[:slots]:
            t = threading.Thread(
                target=self._run, args=(item,),
                daemon=True, name=f"dl-{item.id[:8]}"
            )
            t.start()

    def _run(self, item: DownloadItem) -> None:
        from app.core.ytdlp_wrapper import YTDLPWrapper, _DownloadInterrupted

        wrapper = YTDLPWrapper()

        with self._lock:
            item.status = Status.DOWNLOADING
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
        except _DownloadInterrupted:
            # Download was interrupted by pause() or cancel().
            # The status was already set by those methods — nothing to do here.
            pass
        except Exception as exc:
            with self._lock:
                if item.status not in (Status.PAUSED, Status.CANCELLED):
                    item.status = Status.ERROR
                    item.error  = str(exc)
            self._emit_item("status", item)
        finally:
            self._schedule()   # fill the freed slot with the next pending item

    # ── Event helpers ──────────────────────────────────────────────────────────

    def _emit_item(self, event: str, item: DownloadItem) -> None:
        """Broadcast an event about a single item."""
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
