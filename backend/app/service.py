"""Application service layer: glues providers, tree logic, and metrics together."""

from __future__ import annotations

import asyncio

from . import tree as tree_ops
from .compare import divergence_metrics
from .config import Settings
from .forks import mark_forks
from .providers import CachedProvider, CompletionProvider, MockProvider, TTLCache
from .providers.openai_provider import create_openai_provider
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


class MultiverseService:
    def __init__(self, provider: CompletionProvider, settings: Settings) -> None:
        self.provider = provider
        self.settings = settings

    @classmethod
    def from_settings(cls, settings: Settings, mock_latency: float = 0.25) -> MultiverseService:
        inner: CompletionProvider
        if settings.resolved_provider == "openai":
            if settings.openai_api_key is None:
                raise RuntimeError("MULTIVERSE_PROVIDER=openai requires OPENAI_API_KEY")
            inner = create_openai_provider(
                settings.openai_api_key.get_secret_value(),
                settings.openai_base_url,
                settings.request_timeout_seconds,
            )
        else:
            inner = MockProvider(latency=mock_latency)
        cache = TTLCache(settings.cache_size, settings.cache_ttl_seconds)
        return cls(CachedProvider(inner, cache), settings)

    def _clamp(self, settings: GenerationSettings) -> GenerationSettings:
        limit = self.settings.max_tokens_limit
        return settings.model_copy(update={"max_tokens": min(settings.max_tokens, limit)})

    async def generate(self, req: GenerateRequest) -> Tree:
        settings = self._clamp(req.settings)
        result = await self.provider.complete(req.prompt, settings)
        return tree_ops.create_tree(
            req.prompt, settings, req.fork_settings, result, self.provider.name
        )

    def _prepare(self, tree: Tree) -> Tree:
        """Clamp limits and re-mark forks, since clients may have changed the thresholds."""
        tree.settings = self._clamp(tree.settings)
        for node in tree.nodes.values():
            mark_forks(node.tokens, tree.fork_settings)
        return tree

    async def branch(self, req: BranchRequest) -> BranchResponse:
        tree = self._prepare(req.tree)
        node_id, created = await tree_ops.branch(
            tree, req.node_id, req.position, req.token, self.provider
        )
        return BranchResponse(tree=tree, node_id=node_id, created=created)

    async def explore(self, req: ExploreRequest) -> ExploreResponse:
        tree = self._prepare(req.tree)
        created, truncated = await tree_ops.explore(
            tree,
            req.node_id,
            self.provider,
            top_k=req.top_k,
            depth=req.depth,
            max_nodes=self.settings.max_explore_nodes,
        )
        return ExploreResponse(tree=tree, created=created, truncated=truncated)

    async def compare(self, req: CompareRequest) -> CompareResponse:
        def side(model: str, temperature: float) -> GenerationSettings:
            return self._clamp(
                GenerationSettings(
                    model=model,
                    temperature=temperature,
                    max_tokens=req.max_tokens,
                    top_logprobs=req.top_logprobs,
                )
            )

        a, b = await asyncio.gather(
            self.provider.complete(req.prompt, side(req.a.model, req.a.temperature)),
            self.provider.complete(req.prompt, side(req.b.model, req.b.temperature)),
        )
        mark_forks(a.tokens, req.fork_settings)
        mark_forks(b.tokens, req.fork_settings)
        return CompareResponse(a=a, b=b, metrics=divergence_metrics(a.tokens, b.tokens))
