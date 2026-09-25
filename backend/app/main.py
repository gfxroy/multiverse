"""FastAPI application factory. Run with ``uvicorn app.main:app``."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .api import router
from .config import Settings, get_settings
from .providers import ProviderError
from .ratelimit import RateLimitExceeded
from .service import MultiverseService

logger = logging.getLogger("multiverse")


def create_app(
    settings: Settings | None = None, service: MultiverseService | None = None
) -> FastAPI:
    settings = settings or get_settings()
    svc = service or MultiverseService.from_settings(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await svc.aclose()

    app = FastAPI(
        title="Multiverse",
        version=__version__,
        description="Explore the tokens a language model almost said.",
        lifespan=lifespan,
    )
    app.state.service = svc
    logger.info(
        "Multiverse starting with provider=%s (demo_mode=%s)", svc.provider.name, settings.demo_mode
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        expose_headers=["X-RateLimit-Remaining", "Retry-After"],
    )

    @app.exception_handler(ProviderError)
    async def provider_error_handler(_: Request, exc: ProviderError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(_: Request, exc: RateLimitExceeded) -> JSONResponse:
        return JSONResponse(
            status_code=429,
            content={"detail": exc.message, "retry_after": exc.retry_after},
            headers={"Retry-After": str(exc.retry_after)},
        )

    app.include_router(router)
    if settings.static_dir:
        mount_frontend(app, Path(settings.static_dir))
    return app


def mount_frontend(app: FastAPI, root: Path) -> None:
    """Serve the built SPA (single-container deployments such as Hugging Face Spaces)."""
    index = root / "index.html"
    if not index.is_file():
        raise RuntimeError(f"MULTIVERSE_STATIC_DIR={root} has no index.html; build the frontend")
    app.mount("/assets", StaticFiles(directory=root / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root.resolve()):
            return FileResponse(candidate)
        return FileResponse(index)


app = create_app()
