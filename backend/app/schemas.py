"""Pydantic models shared by the API, providers, and tree logic."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

GenerationMethod = Literal["chat", "chat-continuation", "mock"]


class Alternative(BaseModel):
    """One candidate token at a position, as reported by ``top_logprobs``."""

    token: str
    logprob: float
    prob: float


class TokenInfo(BaseModel):
    """A generated token plus the distribution it was sampled from."""

    token: str
    logprob: float | None = Field(
        default=None, description="Log-probability of the chosen token; None for custom tokens."
    )
    prob: float | None = None
    entropy: float = Field(default=0.0, description="Estimated entropy (bits) of the distribution.")
    margin: float = Field(default=1.0, description="p(top-1) - p(top-2) at this position.")
    top: list[Alternative] = Field(default_factory=list)
    is_fork: bool = False
    fork_score: float = 0.0
    forced: bool = Field(default=False, description="True if a user/explorer forced this token.")


class GenerationSettings(BaseModel):
    model: str = "gpt-4o-mini"
    temperature: float = Field(default=1.0, ge=0.0, le=2.0)
    max_tokens: int = Field(default=80, ge=1, le=2048)
    top_logprobs: int = Field(default=10, ge=1, le=20)
    system_prompt: str | None = None


class ForkSettings(BaseModel):
    """Thresholds for flagging a token as a fork point."""

    entropy_threshold: float = Field(default=1.5, ge=0.0, description="Bits.")
    margin_threshold: float = Field(default=0.15, ge=0.0, le=1.0)
    min_alt_prob: float = Field(
        default=0.05, ge=0.0, le=1.0, description="Runner-up must be at least this likely."
    )


class ProviderResult(BaseModel):
    """What a provider returns for a single completion request."""

    tokens: list[TokenInfo]
    finish_reason: str | None = None
    model: str
    method: GenerationMethod


class Node(BaseModel):
    """A branch in the multiverse tree.

    ``fork_index`` is the position (in the *parent's full path*) at which this node's
    tokens start. The node's full path is ``path(parent)[:fork_index] + tokens``.
    The root has ``parent_id=None`` and ``fork_index=0``.
    """

    id: str
    parent_id: str | None = None
    fork_index: int = 0
    tokens: list[TokenInfo]
    children: list[str] = Field(default_factory=list)
    model: str
    temperature: float
    method: GenerationMethod
    finish_reason: str | None = None
    label: str | None = None


class Tree(BaseModel):
    version: Literal[1] = 1
    prompt: str
    settings: GenerationSettings
    fork_settings: ForkSettings = Field(default_factory=ForkSettings)
    root_id: str
    nodes: dict[str, Node]
    provider: str = "mock"


# ---- API request / response bodies -------------------------------------------------


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    settings: GenerationSettings = Field(default_factory=GenerationSettings)
    fork_settings: ForkSettings = Field(default_factory=ForkSettings)


class BranchRequest(BaseModel):
    tree: Tree
    node_id: str = Field(description="Node whose full path contains the position.")
    position: int = Field(ge=0, description="Index into the node's full path.")
    token: str = Field(min_length=1, max_length=200)


class BranchResponse(BaseModel):
    tree: Tree
    node_id: str
    created: bool


class ExploreRequest(BaseModel):
    tree: Tree
    node_id: str
    top_k: int = Field(default=2, ge=1, le=5, description="Fork points expanded per node.")
    depth: int = Field(default=1, ge=1, le=3)


class ExploreResponse(BaseModel):
    tree: Tree
    created: list[str]
    truncated: bool = False


class CompareSide(BaseModel):
    model: str
    temperature: float = Field(ge=0.0, le=2.0)


class CompareRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    a: CompareSide
    b: CompareSide
    max_tokens: int = Field(default=80, ge=1, le=2048)
    top_logprobs: int = Field(default=10, ge=1, le=20)
    fork_settings: ForkSettings = Field(default_factory=ForkSettings)


class DivergenceMetrics(BaseModel):
    first_divergence_index: int | None = Field(
        description="First position where the two token sequences differ (None if identical)."
    )
    shared_prefix_tokens: int
    position_agreement: float = Field(description="Share of aligned positions with equal tokens.")
    mean_entropy_a: float
    mean_entropy_b: float
    mean_abs_entropy_delta: float
    fork_points_a: int
    fork_points_b: int


class CompareResponse(BaseModel):
    a: ProviderResult
    b: ProviderResult
    metrics: DivergenceMetrics


class ModelsInfo(BaseModel):
    provider: str
    demo_mode: bool
    default_model: str
    models: list[str]
    max_tokens_limit: int
    version: str
