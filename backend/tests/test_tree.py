import pytest

from app import tree as T
from app.providers.mock import MockProvider
from app.schemas import ForkSettings, GenerationSettings, ProviderResult, TokenInfo

from .conftest import make_token


class RecordingProvider:
    """Returns fixed tokens and remembers the prefixes it was asked to continue."""

    name = "recording"

    def __init__(self) -> None:
        self.prefixes: list[str] = []

    async def complete(
        self, prompt: str, settings: GenerationSettings, prefix: str = ""
    ) -> ProviderResult:
        self.prefixes.append(prefix)
        toks = [make_token(" X", {" X": 0.6, " Y": 0.3}), make_token(".", {".": 0.9, "!": 0.1})]
        return ProviderResult(tokens=toks, model=settings.model, method="mock")


def root_tree() -> T.Tree:
    tokens = [
        make_token("The", {"The": 0.9, "A": 0.1}),
        make_token(" cat", {" cat": 0.45, " dog": 0.42, " fox": 0.1}),
        make_token(" sat", {" sat": 0.8, " ran": 0.2}),
        make_token(".", {".": 0.95, "!": 0.05}),
    ]
    result = ProviderResult(tokens=tokens, model="m", method="mock", finish_reason="stop")
    return T.create_tree("p", GenerationSettings(), ForkSettings(), result, "recording")


async def test_branch_creates_child_with_forced_token_and_correct_prefix() -> None:
    tree, provider = root_tree(), RecordingProvider()
    node_id, created = await T.branch(tree, tree.root_id, 1, " dog", provider)
    assert created
    assert provider.prefixes == ["The dog"]
    child = tree.nodes[node_id]
    assert child.parent_id == tree.root_id and child.fork_index == 1
    assert child.tokens[0].token == " dog" and child.tokens[0].forced
    # The forced token keeps the original position's distribution and its own logprob.
    assert [a.token for a in child.tokens[0].top][:2] == [" cat", " dog"]
    assert child.tokens[0].prob == pytest.approx(0.42)
    assert T.tokens_text(T.full_path(tree, node_id)) == "The dog X."
    assert tree.nodes[tree.root_id].children == [node_id]


async def test_branch_with_custom_token_has_no_logprob() -> None:
    tree = root_tree()
    node_id, _ = await T.branch(tree, tree.root_id, 2, " flew", RecordingProvider())
    assert tree.nodes[node_id].tokens[0].logprob is None


async def test_branch_is_idempotent() -> None:
    tree, provider = root_tree(), RecordingProvider()
    first, _ = await T.branch(tree, tree.root_id, 1, " dog", provider)
    second, created = await T.branch(tree, tree.root_id, 1, " dog", provider)
    assert first == second and not created
    assert len(provider.prefixes) == 1


async def test_choosing_the_same_token_is_a_no_op() -> None:
    tree, provider = root_tree(), RecordingProvider()
    node_id, created = await T.branch(tree, tree.root_id, 1, " cat", provider)
    assert node_id == tree.root_id and not created and provider.prefixes == []


async def test_branching_an_ancestor_position_attaches_to_the_owner() -> None:
    tree, provider = root_tree(), RecordingProvider()
    child, _ = await T.branch(tree, tree.root_id, 2, " ran", provider)
    # Position 0 on the child's path belongs to the root.
    assert T.owner_of(tree, child, 0) == tree.root_id
    assert T.owner_of(tree, child, 3) == child
    grand, _ = await T.branch(tree, child, 0, "A", provider)
    assert tree.nodes[grand].parent_id == tree.root_id
    # A position inside the child attaches to the child.
    nested, _ = await T.branch(tree, child, 3, " Y", provider)
    assert tree.nodes[nested].parent_id == child
    assert provider.prefixes[-1] == "The cat ran Y"


async def test_out_of_range_position_raises() -> None:
    tree = root_tree()
    with pytest.raises(T.TreeError):
        await T.branch(tree, tree.root_id, 99, "x", RecordingProvider())
    with pytest.raises(T.TreeError):
        T.full_path(tree, "missing")


def test_cycle_detection() -> None:
    tree = root_tree()
    tree.nodes[tree.root_id].parent_id = tree.root_id
    with pytest.raises(T.TreeError):
        T.lineage(tree, tree.root_id)


async def test_explore_expands_fork_points_breadth_first() -> None:
    tree, provider = root_tree(), RecordingProvider()
    created, truncated = await T.explore(tree, tree.root_id, provider, top_k=2, depth=1)
    assert not truncated
    # Only " cat" (index 1) is a fork in the root; its best unexplored alternative is " dog".
    assert len(created) == 1
    assert tree.nodes[created[0]].tokens[0].token == " dog"
    # Running again picks the next alternative at the same position.
    created2, _ = await T.explore(tree, tree.root_id, provider, top_k=1, depth=1)
    assert tree.nodes[created2[0]].tokens[0].token == " fox"


async def test_explore_respects_node_budget() -> None:
    settings = GenerationSettings(temperature=0.0, max_tokens=30)
    provider = MockProvider()
    result = await provider.complete("Tell me a story about the sea", settings)
    tree = T.create_tree("Tell me a story about the sea", settings, ForkSettings(), result, "mock")
    created, truncated = await T.explore(
        tree, tree.root_id, provider, top_k=3, depth=3, max_nodes=4
    )
    assert len(created) <= 4
    assert truncated
    for nid in created:
        node = tree.nodes[nid]
        assert node.parent_id in tree.nodes
        assert nid in tree.nodes[node.parent_id].children


def test_forced_token_copies_distribution() -> None:
    original = make_token(" cat", {" cat": 0.5, " dog": 0.3})
    forced = T.forced_token(original, " dog")
    assert forced.forced and forced.entropy == original.entropy
    assert isinstance(forced, TokenInfo)
