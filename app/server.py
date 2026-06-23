import asyncio

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.core.paths import UI_DIR

STATIC_DIR = UI_DIR / "static"
LOCALE_DIR = UI_DIR / "locale"


def create_app() -> FastAPI:
    app = FastAPI(title="GRABBIT", version="1.0.0", docs_url=None, redoc_url=None)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Static assets (css, js, img)
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    # Locale JSON files served statically
    app.mount("/locale", StaticFiles(directory=str(LOCALE_DIR)), name="locale")

    # Single-page app root
    @app.get("/")
    async def index():
        return FileResponse(str(UI_DIR / "index.html"))

    @app.get("/health")
    async def health():
        return {"status": "ok", "app": "GRABBIT", "version": "1.0.0"}

    # API routes
    from app.api.routes import router as api_router
    app.include_router(api_router, prefix="/api")

    @app.on_event("startup")
    async def _capture_event_loop() -> None:
        """Store the running event loop so background download threads can
        schedule WebSocket broadcasts on it via run_coroutine_threadsafe."""
        import app.api.routes as routes_module
        routes_module._event_loop = asyncio.get_running_loop()

    return app
