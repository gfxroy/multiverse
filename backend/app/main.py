"""FastAPI application factory. Run with ``uvicorn app.main:app``."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .api import router
from .config import Settings, get_settings
from .providers import ProviderError
from .service import MultiverseService

logger = logging.getLogger("multiverse")


def create_app(
    settings: Settings | None = None, service: MultiverseService | None = None
) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title="Multiverse",
        version=__version__,
        description="Explore the tokens a language model almost said.",
    )
    app.state.service = service or MultiverseService.from_settings(settings)
    logger.info(
        "Multiverse starting with provider=%s (demo_mode=%s)",
        app.state.service.provider.name,
        settings.demo_mode,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @app.exception_handler(ProviderError)
    async def provider_error_handler(_: Request, exc: ProviderError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})

    app.include_router(router)
    return app


app = create_app()
