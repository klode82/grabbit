from __future__ import annotations

import threading
import uuid
from enum import Enum
from typing import Callable, Dict, List, Optional


class Status(str, Enum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    ERROR = "error"
    CANCELLED = "cancelled"


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

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "url": self.url,
            "title": self.title,
            "thumbnail": self.thumbnail,
            "status": self.status,
            "progress": self.progress,
            "speed": self.speed,
            "eta": self.eta,
            "filename": self.filename,
            "error": self.error,
        }


class DownloadQueue:
    """Thread-safe download queue with configurable concurrency."""

    def __init__(self, max_concurrent: int = 2) -> None:
        self._items: Dict[str, DownloadItem] = {}
        self._order: List[str] = []        # preserve insertion order
        self._lock = threading.Lock()
        self.max_concurrent = max_concurrent
        self._listeners: List[Callable[[dict], None]] = []

    # ── Public API ────────────────────────────────────────────────────────────

    def add_listener(self, callback: Callable[[dict], None]) -> None:
        """Register a callback that receives every queue event."""
        self._listeners.append(callback)

    def add(self, url: str, title: str, options: dict) -> DownloadItem:
        """Add an item to the queue and immediately try to start it."""
        item = DownloadItem(url, title, options)
        with self._lock:
            self._items[item.id] = item
            self._order.append(item.id)
        self._emit("added", item)
        self._schedule()
        return item

    def cancel(self, item_id: str) -> bool:
        with self._lock:
            item = self._items.get(item_id)
            if item and item.status in (Status.PENDING,):
                item.status = Status.CANCELLED
                self._emit("status", item)
                return True
        return False

    def remove(self, item_id: str) -> bool:
        with self._lock:
            if item_id in self._items:
                del self._items[item_id]
                self._order = [i for i in self._order if i != item_id]
                self._emit_stats()
                return True
        return False

    def get_all(self) -> List[dict]:
        with self._lock:
            return [self._items[i].to_dict() for i in self._order if i in self._items]

    @property
    def stats(self) -> dict:
        with self._lock:
            items = list(self._items.values())
        return {
            "total": len(items),
            "pending": sum(1 for i in items if i.status == Status.PENDING),
            "active": sum(1 for i in items if i.status == Status.DOWNLOADING),
            "completed": sum(1 for i in items if i.status == Status.COMPLETED),
            "error": sum(1 for i in items if i.status == Status.ERROR),
        }

    # ── Scheduling ────────────────────────────────────────────────────────────

    def _schedule(self) -> None:
        with self._lock:
            active = sum(
                1 for i in self._items.values() if i.status == Status.DOWNLOADING
            )
            slots = self.max_concurrent - active
            if slots <= 0:
                return
            pending = [
                self._items[i]
                for i in self._order
                if i in self._items and self._items[i].status == Status.PENDING
            ]
        for item in pending[:slots]:
            t = threading.Thread(
                target=self._run, args=(item,), daemon=True, name=f"dl-{item.id[:8]}"
            )
            t.start()

    def _run(self, item: DownloadItem) -> None:
        from app.core.ytdlp_wrapper import YTDLPWrapper

        wrapper = YTDLPWrapper()

        with self._lock:
            item.status = Status.DOWNLOADING
        self._emit("status", item)

        def on_progress(data: dict) -> None:
            if data["status"] == "downloading":
                with self._lock:
                    item.progress = data.get("percent", 0.0)
                    item.speed = data.get("speed", "")
                    item.eta = data.get("eta", "")
                    item.filename = data.get("filename", "")
                self._emit("progress", item)
            elif data["status"] == "finished":
                with self._lock:
                    item.progress = 100.0
                    item.filename = data.get("filename", "")

        try:
            wrapper.download(item.url, item.options, progress_callback=on_progress)
            with self._lock:
                item.status = Status.COMPLETED
                item.progress = 100.0
            self._emit("status", item)
        except Exception as exc:
            with self._lock:
                item.status = Status.ERROR
                item.error = str(exc)
            self._emit("status", item)
        finally:
            self._schedule()    # start next pending item if slot freed

    # ── Events ────────────────────────────────────────────────────────────────

    def _emit(self, event: str, item: DownloadItem) -> None:
        payload = {"event": event, "item": item.to_dict(), "stats": self.stats}
        for cb in self._listeners:
            try:
                cb(payload)
            except Exception:
                pass

    def _emit_stats(self) -> None:
        payload = {"event": "stats", "stats": self.stats}
        for cb in self._listeners:
            try:
                cb(payload)
            except Exception:
                pass


# Singleton — shared across the whole app
queue = DownloadQueue(max_concurrent=2)
