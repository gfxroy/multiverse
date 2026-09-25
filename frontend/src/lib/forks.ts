// Mirrors backend/app/forks.py so fork thresholds can be tuned live in the UI.
import type { ForkSettings, TokenInfo, Tree } from './types'

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
