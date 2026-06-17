from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware


UI_DIR = Path(__file__).parent / "ui"
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

    return app
