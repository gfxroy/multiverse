"""The branching multiverse tree: path reconstruction, branching, and auto-exploration.

Invariants:
* ``node.fork_index`` indexes into the *parent's full path*.
* ``full_path(node) == full_path(parent)[:node.fork_index] + node.tokens``.
* A child's first token is the forced token; it keeps the alternatives of the position it
  replaced, because the distribution at that position is unchanged by the choice.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from .entropy import annotate_token
from .forks import mark_forks, rank_forks
from .providers.base import CompletionProvider
from .schemas import (
    ForkSettings,
    GenerationSettings,
    Node,
    ProviderResult,
    TokenInfo,
    Tree,
)


class TreeError(ValueError):
    """Invalid tree operation (unknown node, out-of-range position, ...)."""


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def tokens_text(tokens: Sequence[TokenInfo]) -> str:
    return "".join(t.token for t in tokens)


def get_node(tree: Tree, node_id: str) -> Node:
    try:
        return tree.nodes[node_id]
    except KeyError:
        raise TreeError(f"Unknown node {node_id!r}") from None


def lineage(tree: Tree, node_id: str) -> list[Node]:
    """Nodes from the root down to ``node_id`` (inclusive)."""
    chain: list[Node] = []
    seen: set[str] = set()
    current: str | None = node_id
    while current is not None:
        if current in seen:
            raise TreeError("Cycle detected in tree")
        seen.add(current)
        node = get_node(tree, current)
        chain.append(node)
        current = node.parent_id
    chain.reverse()
    return chain


def full_path(tree: Tree, node_id: str) -> list[TokenInfo]:
    """All tokens from the start of the reply to the end of ``node_id``."""
    path: list[TokenInfo] = []
    for node in lineage(tree, node_id):
        path = path[: node.fork_index] + list(node.tokens)
    return path


def owner_of(tree: Tree, node_id: str, position: int) -> str:
    """The node (on ``node_id``'s lineage) that generated the token at ``position``."""
    node = get_node(tree, node_id)
    while node.parent_id is not None and position < node.fork_index:
        node = get_node(tree, node.parent_id)
    return node.id


def find_child(tree: Tree, parent_id: str, fork_index: int, token: str) -> str | None:
    for child_id in get_node(tree, parent_id).children:
        child = tree.nodes[child_id]
        if child.fork_index == fork_index and child.tokens and child.tokens[0].token == token:
            return child_id
    return None


def forced_token(original: TokenInfo, token: str) -> TokenInfo:
    """A token forced at a position whose distribution is ``original.top``."""
    match = next((a for a in original.top if a.token == token), None)
    forced = TokenInfo(
        token=token,
        logprob=match.logprob if match else None,
        top=[a.model_copy() for a in original.top],
        forced=True,
    )
    return annotate_token(forced)


def create_tree(
    prompt: str,
    settings: GenerationSettings,
    fork_settings: ForkSettings,
    result: ProviderResult,
    provider: str,
) -> Tree:
    root = Node(
        id=new_id(),
        tokens=mark_forks(result.tokens, fork_settings),
        model=result.model,
        temperature=settings.temperature,
        method=result.method,
        finish_reason=result.finish_reason,
        label="root",
    )
    return Tree(
        prompt=prompt,
        settings=settings,
        fork_settings=fork_settings,
        root_id=root.id,
        nodes={root.id: root},
        provider=provider,
    )


@dataclass(frozen=True)
class BranchPlan:
    """Everything needed to generate a branch, resolved before calling the provider."""

    parent_id: str
    position: int
    token: str
    prefix: str
    forced: TokenInfo


def plan_branch(tree: Tree, node_id: str, position: int, token: str) -> BranchPlan | str:
    """Resolve a branch request. Returns an existing node id if no generation is needed."""
    path = full_path(tree, node_id)
    if position >= len(path):
        raise TreeError(f"Position {position} is out of range (path has {len(path)} tokens)")
    parent_id = owner_of(tree, node_id, position)
    original = path[position]
    if original.token == token:
        return node_id  # already on this path; nothing to generate
    existing = find_child(tree, parent_id, position, token)
    if existing is not None:
        return existing
    prefix = tokens_text(path[:position]) + token
    return BranchPlan(parent_id, position, token, prefix, forced_token(original, token))


def attach_branch(tree: Tree, plan: BranchPlan, result: ProviderResult) -> str:
    """Add a generated branch to the tree and return its node id."""
    existing = find_child(tree, plan.parent_id, plan.position, plan.token)
    if existing is not None:  # created concurrently by another plan
        return existing
    parent = get_node(tree, plan.parent_id)
    node = Node(
        id=new_id(),
        parent_id=parent.id,
        fork_index=plan.position,
        tokens=mark_forks([plan.forced, *result.tokens], tree.fork_settings),
        model=result.model,
        temperature=tree.settings.temperature,
        method=result.method,
        finish_reason=result.finish_reason,
    )
    tree.nodes[node.id] = node
    parent.children.append(node.id)
    return node.id


async def branch(
    tree: Tree, node_id: str, position: int, token: str, provider: CompletionProvider
) -> tuple[str, bool]:
    """Force ``token`` at ``position`` of ``node_id``'s path. Returns ``(node_id, created)``."""
    plan = plan_branch(tree, node_id, position, token)
    if isinstance(plan, str):
        return plan, False
    result = await provider.complete(tree.prompt, tree.settings, plan.prefix)
    return attach_branch(tree, plan, result), True


def explore_plans(tree: Tree, node_id: str, top_k: int) -> list[BranchPlan]:
    """Plans that fork ``node_id`` at its ``top_k`` most uncertain positions.

    At each fork position we take the most likely alternative that has not been explored yet.
    """
    node = get_node(tree, node_id)
    start = 1 if node.parent_id is not None else 0  # skip this node's own forced token
    plans: list[BranchPlan] = []
    for local_idx in rank_forks(node.tokens, start=start):
        if len(plans) >= top_k:
            break
        position = node.fork_index + local_idx
        chosen = node.tokens[local_idx]
        for alt in chosen.top:
            if alt.token == chosen.token or not alt.token:
                continue
            plan = plan_branch(tree, node_id, position, alt.token)
            if isinstance(plan, BranchPlan):
                plans.append(plan)
                break
    return plans


async def explore(
    tree: Tree,
    node_id: str,
    provider: CompletionProvider,
    top_k: int = 2,
    depth: int = 1,
    max_nodes: int = 24,
    grant: Callable[[int], int] | None = None,
) -> tuple[list[str], bool]:
    """Breadth-first auto-exploration. Returns ``(created_ids, truncated)``.

    Each level's provider calls run concurrently; results are attached in a deterministic
    order so the tree shape does not depend on network timing. ``grant(n)`` (e.g. a rate
    limiter) may allow fewer than ``n`` calls, which truncates the exploration.
    """
    created: list[str] = []
    frontier = [node_id]
    truncated = False
    for _ in range(depth):
        plans: list[BranchPlan] = []
        for nid in frontier:
            plans.extend(explore_plans(tree, nid, top_k))
        budget = max_nodes - len(created)
        if len(plans) > budget:
            plans, truncated = plans[: max(budget, 0)], True
        if not plans:
            break
        if grant is not None:
            allowed = grant(len(plans))
            if allowed < len(plans):
                plans, truncated = plans[:allowed], True
            if not plans:
                break
        results = await asyncio.gather(
            *(provider.complete(tree.prompt, tree.settings, p.prefix) for p in plans)
        )
        frontier = []
        for plan, result in zip(plans, results, strict=True):
            new_id_ = attach_branch(tree, plan, result)
            if new_id_ not in created:
                created.append(new_id_)
                frontier.append(new_id_)
        if truncated:
            break
    return created, truncated
