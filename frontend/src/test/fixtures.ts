import type { TokenInfo, Tree, TreeNode } from '../lib/types'

export function tok(
  token: string,
  probs: Record<string, number>,
  extra: Partial<TokenInfo> = {},
): TokenInfo {
  const top = Object.entries(probs)
    .map(([t, p]) => ({ token: t, prob: p, logprob: Math.log(p) }))
    .sort((a, b) => b.prob - a.prob)
  const ps = top.map((a) => a.prob)
  const tail = Math.max(0, 1 - ps.reduce((a, b) => a + b, 0))
  const entropy = -[...ps, tail].filter((p) => p > 0).reduce((a, p) => a + p * Math.log2(p), 0)
  return {
    token,
    logprob: probs[token] ? Math.log(probs[token]) : null,
    prob: probs[token] ?? null,
    entropy,
    margin: ps.length > 1 ? ps[0] - ps[1] : (ps[0] ?? 1),
    top,
    is_fork: false,
    fork_score: 0,
    forced: false,
    ...extra,
  }
}

function node(
  id: string,
  parent: string | null,
  fork: number,
  words: string[],
  children: string[] = [],
): TreeNode {
  return {
    id,
    parent_id: parent,
    fork_index: fork,
    tokens: words.map((w, i) =>
      tok(w, { [w]: 0.6, '~': 0.3 }, { forced: parent !== null && i === 0 }),
    ),
    children,
    model: 'm',
    temperature: 1,
    method: 'mock',
    finish_reason: 'stop',
  }
}

/**
 * root: "The cat sat ."
 *   ├─ a  @1: " dog ran ."        -> "The dog ran ."
 *   │    └─ c @2: " slept"        -> "The dog slept"
 *   └─ b  @3: "!"                 -> "The cat sat!"
 */
export function sampleTree(): Tree {
  return {
    version: 1,
    prompt: 'p',
    settings: { model: 'm', temperature: 1, max_tokens: 10, top_logprobs: 5 },
    fork_settings: { entropy_threshold: 1.5, margin_threshold: 0.15, min_alt_prob: 0.05 },
    root_id: 'root',
    provider: 'mock',
    nodes: {
      root: node('root', null, 0, ['The', ' cat', ' sat', '.'], ['a', 'b']),
      a: node('a', 'root', 1, [' dog', ' ran', '.'], ['c']),
      c: node('c', 'a', 2, [' slept']),
      b: node('b', 'root', 3, ['!']),
    },
  }
}
