"""HTTP routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response

from . import __version__
from .config import PROVIDER_MODELS
from .providers import CachedProvider
from .schemas import (
    BranchRequest,
    BranchResponse,
    CompareRequest,
    CompareResponse,
    ExploreRequest,
    ExploreResponse,
    GenerateRequest,
    LimitsInfo,
    ModelsInfo,
    Tree,
)
from .service import ByokProvider, MultiverseService, RequestContext
from .tree import TreeError

router = APIRouter(prefix="/api")

# Visitor-supplied keys arrive in these headers, are used for that request only, and are
# never logged or stored.
PROVIDER_HEADER = "X-Multiverse-Provider"
KEY_HEADER = "X-Multiverse-Key"


def get_service(request: Request) -> MultiverseService:
    service: MultiverseService = request.app.state.service
    return service


Service = Annotated[MultiverseService, Depends(get_service)]


def client_ip(request: Request, trusted_proxy_hops: int) -> str:
    """Visitor IP. Behind N trusted proxies, the Nth entry from the right of
    ``X-Forwarded-For`` is the first one a client can't forge."""
    if trusted_proxy_hops > 0:
        forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",")]
        forwarded = [p for p in forwarded if p]
        if forwarded:
            return forwarded[-min(trusted_proxy_hops, len(forwarded))]
    return request.client.host if request.client else "unknown"


def get_context(
    request: Request,
    response: Response,
    service: Service,
    provider: Annotated[str | None, Header(alias=PROVIDER_HEADER)] = None,
    key: Annotated[str | None, Header(alias=KEY_HEADER)] = None,
) -> RequestContext:
    byok: tuple[ByokProvider, str] | None = None
    if key and key.strip():
        if not service.settings.allow_byok:
            raise HTTPException(status_code=400, detail="Using your own key is disabled here.")
        allowed = service.settings.byok_providers
        if provider not in allowed:
            raise HTTPException(
                status_code=400, detail=f"Own-key provider must be one of: {', '.join(allowed)}."
            )
        byok = (provider, key.strip())
    ip = client_ip(request, service.settings.trusted_proxy_hops)
    ctx = service.context(ip, byok)
    request.state.budget = ctx.budget
    return ctx


Context = Annotated[RequestContext, Depends(get_context)]


def _remaining_header(request: Request, response: Response) -> None:
    budget = getattr(request.state, "budget", None)
    remaining = budget.remaining() if budget else None
    if remaining is not None:
        response.headers["X-RateLimit-Remaining"] = str(remaining)


@router.get("/health")
async def health(service: Service) -> dict[str, object]:
    cache = service.provider.cache.stats if isinstance(service.provider, CachedProvider) else None
    return {
        "status": "ok",
        "provider": service.provider.name,
        "demo_mode": service.settings.demo_mode,
        "cache": cache.__dict__ if cache else None,
    }


@router.get("/debug/client", include_in_schema=False)
async def debug_client(request: Request, service: Service) -> dict[str, object]:
    """The caller's own address as the app sees it (only when explicitly enabled)."""
    s = service.settings
    if not s.debug_client_ip:
        raise HTTPException(status_code=404, detail="Not Found")
    return {
        "resolved_ip": client_ip(request, s.trusted_proxy_hops),
        "trusted_proxy_hops": s.trusted_proxy_hops,
        "x_forwarded_for": request.headers.get("x-forwarded-for"),
        "peer": request.client.host if request.client else None,
    }


@router.get("/config", response_model=ModelsInfo)
async def config(request: Request, service: Service) -> ModelsInfo:
    s = service.settings
    budget = service.context(client_ip(request, s.trusted_proxy_hops)).budget
    return ModelsInfo(
        provider=service.provider.name,
        demo_mode=s.demo_mode,
        default_model=s.default_model,
        models=s.models,
        provider_models={k: v for k, v in PROVIDER_MODELS.items() if k != "mock"},
        allow_byok=s.allow_byok,
        byok_providers=list(s.byok_providers),
        max_tokens_limit=s.max_tokens_limit,
        limits=LimitsInfo(
            rate_limit_calls=s.rate_limit_calls,
            rate_limit_window_seconds=s.rate_limit_window_seconds,
            daily_call_cap=s.daily_call_cap,
            max_top_logprobs=s.max_top_logprobs,
            max_explore_nodes=s.max_explore_nodes,
            max_prompt_chars=s.max_prompt_chars,
            remaining=budget.remaining(),
        ),
        version=__version__,
    )


@router.post("/generate", response_model=Tree)
async def generate(
    req: GenerateRequest, request: Request, response: Response, service: Service, ctx: Context
) -> Tree:
    try:
        return await service.generate(req, ctx)
    except TreeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        _remaining_header(request, response)


@router.post("/branch", response_model=BranchResponse)
async def branch(
    req: BranchRequest, request: Request, response: Response, service: Service, ctx: Context
) -> BranchResponse:
    try:
        return await service.branch(req, ctx)
    except TreeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        _remaining_header(request, response)


@router.post("/explore", response_model=ExploreResponse)
async def explore(
    req: ExploreRequest, request: Request, response: Response, service: Service, ctx: Context
) -> ExploreResponse:
    try:
        return await service.explore(req, ctx)
    except TreeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        _remaining_header(request, response)


@router.post("/compare", response_model=CompareResponse)
async def compare(
    req: CompareRequest, request: Request, response: Response, service: Service, ctx: Context
) -> CompareResponse:
    try:
        return await service.compare(req, ctx)
    except TreeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        _remaining_header(request, response)
