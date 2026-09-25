// Port of backend/app/compare.py.
import type { DivergenceMetrics, TokenInfo } from '../lib/types'
import { mean } from './entropy'

/** Index of the first differing token; null if the sequences are identical. */
export function firstDivergence(a: TokenInfo[], b: TokenInfo[]): number | null {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i].token !== b[i].token) return i
  return a.length === b.length ? null : n
}

export function divergenceMetrics(a: TokenInfo[], b: TokenInfo[]): DivergenceMetrics {
  const first = firstDivergence(a, b)
  const aligned = Math.min(a.length, b.length)
  const longest = Math.max(a.length, b.length)
  let agree = 0
  const deltas: number[] = []
  for (let i = 0; i < aligned; i++) {
    if (a[i].token === b[i].token) agree++
    deltas.push(Math.abs(a[i].entropy - b[i].entropy))
  }
  return {
    first_divergence_index: first,
    shared_prefix_tokens: first === null ? aligned : first,
    position_agreement: longest ? agree / longest : 1,
    mean_entropy_a: mean(a.map((t) => t.entropy)),
    mean_entropy_b: mean(b.map((t) => t.entropy)),
    mean_abs_entropy_delta: aligned ? mean(deltas) : 0,
    fork_points_a: a.filter((t) => t.is_fork).length,
    fork_points_b: b.filter((t) => t.is_fork).length,
  }
}
