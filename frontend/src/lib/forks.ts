// Mirrors backend/app/forks.py so fork thresholds can be tuned live in the UI.
import type { ForkSettings, TokenInfo, Tree } from './types'

/** Entropy (bits) of observed probabilities plus one bucket for the unobserved tail. */
export function truncatedEntropy(probs: number[]): number {
  const total = probs.reduce((a, b) => a + b, 0)
  const ps = total > 1 + 1e-6 ? probs.map((p) => p / total) : probs
  const tail = Math.max(0, 1 - ps.reduce((a, b) => a + b, 0))
  return Math.max(
    0,
    -[...ps, tail].filter((p) => p > 1e-12).reduce((a, p) => a + p * Math.log2(p), 0),
  )
}

export const maxEntropy = (k: number) => Math.log2(Math.max(k, 1) + 1)

export function forkScore(t: TokenInfo): number {
  if (t.top.length < 2) return 0
  const norm = Math.min(1, t.entropy / maxEntropy(t.top.length))
  return 0.5 * norm + 0.5 * (1 - t.margin)
}

export function isFork(t: TokenInfo, s: ForkSettings): boolean {
  if (t.forced || t.top.length < 2) return false
  if (t.top[1].prob < s.min_alt_prob) return false
  return t.entropy >= s.entropy_threshold || t.margin <= s.margin_threshold
}

/** Return a copy of the tree with fork flags recomputed for new thresholds. */
export function remarkTree(tree: Tree, s: ForkSettings): Tree {
  const nodes = Object.fromEntries(
    Object.entries(tree.nodes).map(([id, node]) => [
      id,
      {
        ...node,
        tokens: node.tokens.map((t) => ({ ...t, fork_score: forkScore(t), is_fork: isFork(t, s) })),
      },
    ]),
  )
  return { ...tree, fork_settings: s, nodes }
}
