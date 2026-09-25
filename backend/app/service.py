"""Application service layer: glues providers, tree logic, limits and metrics together."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Literal

import httpx

from . import tree as tree_ops
from .compare import divergence_metrics
from .config import Settings
from .forks import mark_forks
from .providers import (
    CachedProvider,
    CompletionProvider,
    ConcurrencyLimited,
    GeminiProvider,
    MockProvider,
    TTLCache,
)
from .providers.openai_provider import create_openai_provider
from .ratelimit import UNLIMITED, Budget, RateLimiter, RateLimitExceeded
from .schemas import (
    BranchRequest,
    BranchResponse,
    CompareRequest,
    CompareResponse,
    ExploreRequest,
    ExploreResponse,
    GenerateRequest,
    GenerationSettings,
    Tree,
)
from .tree import BranchPlan, TreeError

ByokProvider = Literal["openai", "gemini"]


@dataclass
class RequestContext:
    """Per-request provider and rate-limit budget."""

    provider: CompletionProvider
    budget: Budget = UNLIMITED
    byok: bool = False


class MultiverseService:
    def __init__(
        self,
        provider: CompletionProvider,
        settings: Settings,
        cache: TTLCache | None = None,
        limiter: RateLimiter | None = None,
    ) -> None:
        self.provider = provider
        self.settings = settings
        self.cache = cache or TTLCache(settings.cache_size, settings.cache_ttl_seconds)
        self.limiter = limiter or RateLimiter(
            settings.rate_limit_calls, settings.rate_limit_window_seconds, settings.daily_call_cap
        )
        self.semaphore = asyncio.Semaphore(settings.max_concurrency)
        self._http: httpx.AsyncClient | None = None

    @property
    def http(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=self.settings.request_timeout_seconds)
        return self._http

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()

    @classmethod
    def from_settings(cls, settings: Settings, mock_latency: float = 0.25) -> MultiverseService:
        service = cls(MockProvider(latency=mock_latency), settings)
        resolved = settings.resolved_provider
        if resolved != "mock":
            secret = settings.openai_api_key if resolved == "openai" else settings.gemini_api_key
            if secret is None or not secret.get_secret_value().strip():
                env = "OPENAI_API_KEY" if resolved == "openai" else "GEMINI_API_KEY"
                raise RuntimeError(f"MULTIVERSE_PROVIDER={resolved} requires {env}")
            service.provider = service.build_provider(resolved, secret.get_secret_value())
        else:
            service.provider = service._wrap(service.provider)
        return service

    def _wrap(self, inner: CompletionProvider) -> CompletionProvider:
        return CachedProvider(ConcurrencyLimited(inner, self.semaphore), self.cache)

    def build_provider(
        self, name: ByokProvider, api_key: str, *, visitor: bool = False
    ) -> CompletionProvider:
        """A cached, concurrency-limited provider for ``name`` using ``api_key``.

        Visitor keys always go to the provider's official endpoint: a custom base URL is only
        honoured for the server's own key, so visitors can't point the server elsewhere.
        """
        timeout = self.settings.request_timeout_seconds
        inner: CompletionProvider
        if name == "openai":
            base_url = None if visitor else self.settings.openai_base_url
            inner = create_openai_provider(api_key, base_url, timeout, http_client=self.http)
        else:
            base_url = GeminiProvider.DEFAULT_BASE_URL if visitor else self.settings.gemini_base_url
            inner = GeminiProvider(api_key, base_url, client=self.http)
        return self._wrap(inner)

    def context(
        self, client_key: str, byok: tuple[ByokProvider, str] | None = None
    ) -> RequestContext:
        if byok is not None:
            name, key = byok
            return RequestContext(
                provider=self.build_provider(name, key, visitor=True),
                budget=Budget(
                    self.limiter,
                    client_key,
                    multiplier=self.settings.byok_rate_multiplier,
                    count_global=False,
                ),
                byok=True,
            )
        if self.settings.demo_mode:
            return RequestContext(provider=self.provider)  # the mock model costs nothing
        return RequestContext(provider=self.provider, budget=Budget(self.limiter, client_key))

    # ---- validation / clamping ---------------------------------------------------------

    def _clamp(self, settings: GenerationSettings) -> GenerationSettings:
        s = self.settings
        return settings.model_copy(
            update={
                "max_tokens": min(settings.max_tokens, s.max_tokens_limit),
                "top_logprobs": min(settings.top_logprobs, s.max_top_logprobs),
            }
        )

    def _check_prompt(self, prompt: str) -> None:
        if len(prompt) > self.settings.max_prompt_chars:
            raise TreeError(f"Prompt is too long (max {self.settings.max_prompt_chars} characters)")

    def _prepare(self, tree: Tree) -> Tree:
        """Validate limits, clamp settings and re-mark forks (clients may change thresholds)."""
        self._check_prompt(tree.prompt)
        if len(tree.nodes) > self.settings.max_tree_nodes:
            raise TreeError(f"Tree is too large (max {self.settings.max_tree_nodes} branches)")
        tree.settings = self._clamp(tree.settings)
        for node in tree.nodes.values():
            mark_forks(node.tokens, tree.fork_settings)
        return tree

    # ---- operations --------------------------------------------------------------------

    async def generate(self, req: GenerateRequest, ctx: RequestContext | None = None) -> Tree:
        ctx = ctx or RequestContext(self.provider)
        self._check_prompt(req.prompt)
        settings = self._clamp(req.settings)
        ctx.budget.take(1)
        result = await ctx.provider.complete(req.prompt, settings)
        return tree_ops.create_tree(
            req.prompt, settings, req.fork_settings, result, ctx.provider.name
        )

    async def branch(self, req: BranchRequest, ctx: RequestContext | None = None) -> BranchResponse:
        ctx = ctx or RequestContext(self.provider)
        tree = self._prepare(req.tree)
        plan = tree_ops.plan_branch(tree, req.node_id, req.position, req.token)
        if not isinstance(plan, BranchPlan):
            return BranchResponse(tree=tree, node_id=plan, created=False)
        ctx.budget.take(1)
        result = await ctx.provider.complete(tree.prompt, tree.settings, plan.prefix)
        node_id = tree_ops.attach_branch(tree, plan, result)
        return BranchResponse(tree=tree, node_id=node_id, created=True)

    async def explore(
        self, req: ExploreRequest, ctx: RequestContext | None = None
    ) -> ExploreResponse:
        ctx = ctx or RequestContext(self.provider)
        tree = self._prepare(req.tree)
        spent = 0
        limited = False

        def grant(n: int) -> int:
            # Every spawned branch costs one call. The first level must get at least one call
            # (else 429); later levels just stop early when the budget runs out.
            nonlocal spent, limited
            try:
                allowed = ctx.budget.take(n, partial=True)
            except RateLimitExceeded:
                if spent == 0:
                    raise
                limited = True
                return 0
            limited = limited or allowed < n
            spent += allowed
            return allowed

        created, truncated = await tree_ops.explore(
            tree,
            req.node_id,
            ctx.provider,
            top_k=req.top_k,
            depth=req.depth,
            max_nodes=self.settings.max_explore_nodes,
            grant=grant,
        )
        return ExploreResponse(
            tree=tree, created=created, truncated=truncated, rate_limited=limited
        )

    async def compare(
        self, req: CompareRequest, ctx: RequestContext | None = None
    ) -> CompareResponse:
        ctx = ctx or RequestContext(self.provider)
        self._check_prompt(req.prompt)

        def side(model: str, temperature: float) -> GenerationSettings:
            return self._clamp(
                GenerationSettings(
                    model=model,
                    temperature=temperature,
                    max_tokens=req.max_tokens,
                    top_logprobs=req.top_logprobs,
                )
            )

        ctx.budget.take(2)
        a, b = await asyncio.gather(
            ctx.provider.complete(req.prompt, side(req.a.model, req.a.temperature)),
            ctx.provider.complete(req.prompt, side(req.b.model, req.b.temperature)),
        )
        mark_forks(a.tokens, req.fork_settings)
        mark_forks(b.tokens, req.fork_settings)
        return CompareResponse(a=a, b=b, metrics=divergence_metrics(a.tokens, b.tokens))
