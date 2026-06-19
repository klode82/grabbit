from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.core.ytdlp_wrapper import YTDLPWrapper
from app.core.download_queue import queue, Status
from app.core.settings_manager import settings

router = APIRouter()
_wrapper = YTDLPWrapper()

# Active WebSocket connections
_ws_clients: list[WebSocket] = []

# The asyncio event loop running in the main thread.
# Set once at FastAPI startup (see server.py) so background download
# threads can schedule WebSocket broadcasts on it via run_coroutine_threadsafe.
_event_loop: asyncio.AbstractEventLoop | None = None


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket — live updates
# ─────────────────────────────────────────────────────────────────────────────

@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    _ws_clients.append(ws)
    # Send current queue state immediately on connect
    try:
        await ws.send_json({"event": "init", "items": queue.get_all(), "stats": queue.stats})
        while True:
            await ws.receive_text()   # keep alive
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.remove(ws)


async def _broadcast(payload: dict) -> None:
    dead = []
    for ws in _ws_clients:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _ws_clients.remove(ws)


def _queue_event_handler(payload: dict) -> None:
    """Called from background download threads.

    Uses the event loop cached at startup to schedule a WebSocket broadcast
    on the main async thread via run_coroutine_threadsafe — the only safe
    way to call async code from a non-async thread.
    """
    if _event_loop and _event_loop.is_running():
        asyncio.run_coroutine_threadsafe(_broadcast(payload), _event_loop)


# Register once at import time
queue.add_listener(_queue_event_handler)


# ─────────────────────────────────────────────────────────────────────────────
# Analyze
# ─────────────────────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    url: str


@router.post("/analyze")
async def analyze(req: AnalyzeRequest) -> Any:
    if not req.url.strip():
        raise HTTPException(status_code=422, detail="URL cannot be empty")
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(None, _wrapper.analyze, req.url.strip())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Playlist — per-entry analysis (streaming)
# ─────────────────────────────────────────────────────────────────────────────

class PlaylistAnalyzeRequest(BaseModel):
    url: str


@router.post("/analyze/playlist-entry")
async def analyze_playlist_entry(req: PlaylistAnalyzeRequest) -> Any:
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(
            None, _wrapper.analyze_playlist_entry, req.url.strip()
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Queue
# ─────────────────────────────────────────────────────────────────────────────

class QueueAddRequest(BaseModel):
    url: str
    title: str
    options: dict = {}


@router.get("/queue")
async def get_queue() -> Any:
    return {"items": queue.get_all(), "stats": queue.stats}


@router.post("/queue/add")
async def add_to_queue(req: QueueAddRequest) -> Any:
    # Inject download path and title from request if not already in options.
    opts = dict(req.options)
    if "output_dir" not in opts:
        opts["output_dir"] = settings.get("output_dir", ".")
    if "title" not in opts:
        opts["title"] = req.title
    if "output_template" not in opts:
        tpl = settings.get("filename_template", "")
        if tpl:
            output_dir = opts.get("output_dir", ".")
            opts["output_template"] = f"{output_dir}/{tpl}"
    # Inject subtitle format from settings when subtitles are requested
    if "subtitle_lang" in opts and "subtitle_format" not in opts:
        opts["subtitle_format"] = settings.get("subtitle_format", "srt")
    # Use default output format from settings if not explicitly set
    if "merge_output_format" not in opts:
        opts["merge_output_format"] = settings.get("default_output_format", "mp4")

    item = queue.add(req.url, req.title, opts)
    return item.to_dict()


# ── Global queue actions (must be defined BEFORE /{item_id} routes) ──────────

@router.post("/queue/pause-all")
async def pause_all() -> Any:
    queue.pause_all()
    return {"ok": True, "stats": queue.stats}


@router.post("/queue/resume-all")
async def resume_all() -> Any:
    queue.resume_all()
    return {"ok": True, "stats": queue.stats}


@router.delete("/queue/completed")
async def clear_completed() -> Any:
    n = queue.clear_completed()
    return {"ok": True, "removed": n, "stats": queue.stats}


@router.delete("/queue/all")
async def clear_all() -> Any:
    queue.clear_all()
    return {"ok": True, "stats": queue.stats}


# ── Per-item actions ──────────────────────────────────────────────────────────

@router.post("/queue/{item_id}/pause")
async def pause_item(item_id: str) -> Any:
    ok = queue.pause(item_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Item cannot be paused")
    return {"ok": True, "stats": queue.stats}


@router.post("/queue/{item_id}/resume")
async def resume_item(item_id: str) -> Any:
    queue.resume(item_id)
    return {"ok": True, "stats": queue.stats}


@router.post("/queue/{item_id}/restart")
async def restart_item(item_id: str) -> Any:
    ok = queue.restart(item_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Item cannot be restarted")
    return {"ok": True, "stats": queue.stats}


@router.post("/queue/{item_id}/cancel")
async def cancel_item(item_id: str) -> Any:
    ok = queue.cancel(item_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Item cannot be cancelled")
    return {"ok": True}


@router.delete("/queue/{item_id}")
async def remove_from_queue(item_id: str) -> Any:
    removed = queue.remove(item_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True, "stats": queue.stats}


@router.get("/queue/stats")
async def queue_stats() -> Any:
    return queue.stats


# ─────────────────────────────────────────────────────────────────────────────
# Settings
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/settings")
async def get_settings() -> Any:
    return settings.get_all()


# Sync queue concurrency with saved settings at startup
queue.max_concurrent = int(settings.get("max_concurrent", 2))


@router.post("/settings")
async def save_settings(patch: dict) -> Any:
    result = settings.update(patch)
    if "max_concurrent" in patch:
        queue.max_concurrent = int(patch.get("max_concurrent", 2))
    return result


@router.post("/settings/reset")
async def reset_settings() -> Any:
    result = settings.reset()
    queue.max_concurrent = int(result.get("max_concurrent", 2))
    return result
