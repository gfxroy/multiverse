# How branching works (and where it is approximate)

Multiverse lets you click any generated token, pick a different one, and see how the rest
of the answer would have unfolded. This page explains exactly what happens when you do
that, and what the limits are.

## Data model

A generation is a **tree of nodes**. Each node stores:

| field        | meaning                                                                |
| ------------ | ---------------------------------------------------------------------- |
| `parent_id`  | the node it branched from (`null` for the root)                        |
| `fork_index` | position in the **parent's full path** where this node's tokens begin  |
| `tokens`     | the tokens this node generated; `tokens[0]` is the forced token         |

The text of a node is always:

```
full_path(node) = full_path(parent)[:fork_index] + node.tokens
```

So a branch shares its parent's prefix and only stores what's new. When you click a token
that belongs to an *ancestor* of the active node, the new branch is attached to the ancestor
that actually generated that position (`owner_of` in `backend/app/tree.py`). Branching the
same token twice at the same position reuses the existing node.

The forced token keeps the alternatives of the position it replaced, because the
distribution at that position doesn't change when you pick a different option. Its
`logprob` is taken from that distribution if the token was one of the top-k alternatives,
and is `null` if you typed your own.

## Continuing from a forced token

Once the token is forced, the backend needs the model to continue from
`prefix = text before the position + forced token`.

**Root generations** are plain Chat Completions requests (`logprobs: true`,
`top_logprobs: k`), so their per-token distributions are exactly what the API returned.

**Branches** have a problem: the Chat Completions API can't prefill the assistant turn.
There's no supported way to say "the assistant's reply starts with this exact text,
continue it". Multiverse uses a *continuation prompt* instead:

```jsonc
[
  { "role": "system", "content": "<optional system prompt>" },
  { "role": "user", "content": "<original prompt>" },
  { "role": "assistant", "content": "<prefix + forced token>" },
  { "role": "user", "content": "Continue your previous message exactly where it stopped ... Output only the continuation text ..." }
]
```

The returned tokens (and their logprobs) are appended after the forced token. The request
is marked `method: "chat-continuation"` in the tree, and the UI shows which method produced
each node.

The native **Gemini** provider does the same thing in Gemini's `contents` format: a `user`
turn with the prompt, a `model` turn with the prefix and forced token, and a `user` turn
with the continue instruction. It reads per-token distributions from
`candidates[0].logprobsResult` (`chosenCandidates` and `topCandidates`). Google documents
logprobs for Gemini 2.x models only; 3.x models don't return them.

### Limitations (please read)

- **The distributions are conditional on a different context.** In a branch, the model is
  answering "continue this message", not generating the original reply. The next-token
  distributions are close in spirit but *not* the true
  `p(token | prompt, prefix)` you would get from real prefix continuation. Treat entropies
  and probabilities inside branches as approximate. Root-node numbers are exact API values.
- **Whitespace and mid-word joins can drift.** Models sometimes drop or add a leading space
  or restart a word, even when told not to. No heuristic cleanup is applied, so what you
  see is what the model returned.
- **The model may repeat or restart** the draft despite the instruction. Low temperatures
  help.
- **Tokens are shown as strings.** The API also returns `bytes`. A multi-byte character
  split across tokens can show up as odd fragments.
- **Only the top-k (≤ 20) alternatives are visible.** Entropy is computed from those plus
  one "tail" bucket for the unobserved mass, which gives a *lower bound* on the true entropy.
  The sampled token can fall outside the top-k. The API then reports it with a very low
  logprob (`-9999`), and the UI says so.
- **Model support varies.** Reasoning models generally reject `logprobs`, Gemini 3.x doesn't
  return them, and Gemini's OpenAI-compatible endpoint rejects the parameter. Use a model
  that returns logprobs (for example `gpt-4o-mini` or `gemini-2.5-flash`). If a model returns no
  logprobs, the backend responds with a clear 502 error.

### Why not use something else?

- **Legacy Completions API with raw prompts** (e.g. `gpt-3.5-turbo-instruct`) supports true
  prefix continuation, but it only returns up to 5 alternatives and doesn't support
  current chat models.
- **Open-weights models** served with vLLM or llama.cpp support exact continuation and full
  distributions. The provider interface (`backend/app/providers/base.py`) is small on
  purpose so a provider like that could be added. It's on the roadmap.

## Auto-explore

`POST /api/explore` does a breadth-first expansion:

1. On the selected node, rank fork points by `fork_score` (skipping the node's own forced
   token).
2. For each of the top-k positions, take the most likely alternative that hasn't been
   explored yet and plan a branch.
3. Run all planned branches of a level concurrently (`asyncio.gather`), then attach them in
   a fixed order so the tree shape doesn't depend on network timing.
4. Repeat on the newly created nodes, `depth` times, capped by
   `MULTIVERSE_MAX_EXPLORE_NODES` (default 24).

Identical provider requests are served from an in-memory TTL/LRU cache, and concurrent
duplicate requests share one upstream call.

## Fork points

A token is a fork point when the runner-up is plausible (`p₂ ≥ min_alt_prob`) **and**
either the entropy is high (`H ≥ entropy_threshold` bits) or the top-2 margin is thin
(`p₁ − p₂ ≤ margin_threshold`). Forced tokens are never flagged. The ranking score is

```
fork_score = ½ · H / log₂(k + 1)  +  ½ · (1 − margin)      ∈ [0, 1]
```

Thresholds are editable in the UI. The frontend recomputes the flags live, and the backend
recomputes them from the tree's `fork_settings` before exploring.
