"""HTTP routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from . import __version__
from .providers import CachedProvider
from .schemas import (
    BranchRequest,
    BranchResponse,
    CompareRequest,
    CompareResponse,
    ExploreRequest,
    ExploreResponse,
    GenerateRequest,
    ModelsInfo,
    Tree,
)
from .service import MultiverseService
from .tree import TreeError

router = APIRouter(prefix="/api")


def get_service(request: Request) -> MultiverseService:
    service: MultiverseService = request.app.state.service
    return service


Service = Annotated[MultiverseService, Depends(get_service)]


@router.get("/health")
async def health(service: Service) -> dict[str, object]:
    cache = service.provider.cache.stats if isinstance(service.provider, CachedProvider) else None
    return {
        "status": "ok",
        "provider": service.provider.name,
        "demo_mode": service.settings.demo_mode,
        "cache": cache.__dict__ if cache else None,
    }


@router.get("/config", response_model=ModelsInfo)
async def config(service: Service) -> ModelsInfo:
    s = service.settings
    models = list(dict.fromkeys([s.default_model, *s.models]))
    return ModelsInfo(
        provider=service.provider.name,
        demo_mode=s.demo_mode,
        default_model=s.default_model,
        models=models,
        max_tokens_limit=s.max_tokens_limit,
        version=__version__,
    )


@router.post("/generate", response_model=Tree)
async def generate(req: GenerateRequest, service: Service) -> Tree:
    return await service.generate(req)


@router.post("/branch", response_model=BranchResponse)
async def branch(req: BranchRequest, service: Service) -> BranchResponse:
    try:
        return await service.branch(req)
    except TreeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/explore", response_model=ExploreResponse)
async def explore(req: ExploreRequest, service: Service) -> ExploreResponse:
    try:
        return await service.explore(req)
    except TreeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/compare", response_model=CompareResponse)
async def compare(req: CompareRequest, service: Service) -> CompareResponse:
    return await service.compare(req)
