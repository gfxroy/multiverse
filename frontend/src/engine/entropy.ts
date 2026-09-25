// Port of backend/app/entropy.py. The top-k alternatives are all an API returns, so the
// unobserved mass is one "tail" bucket and entropies are lower bounds.
import { truncatedEntropy } from '../lib/forks'
import type { Alternative, TokenInfo } from '../lib/types'

export { maxEntropy, truncatedEntropy } from '../lib/forks'

/** Natural-log probability to a probability, clamped into [0, 1]. */
export function logprobToProb(logprob: number): number {
  return Math.min(1, Math.max(0, Math.exp(logprob)))
}

export function tailMass(probs: number[]): number {
  return Math.max(0, 1 - probs.reduce((a, b) => a + b, 0))
}

/** p(top-1) - p(top-2); 1.0 if nothing is known, p(top-1) if only one alternative is. */
export function top2Margin(probs: number[]): number {
  const ordered = [...probs].sort((a, b) => b - a)
  if (ordered.length === 0) return 1
  if (ordered.length === 1) return ordered[0]
  return ordered[0] - ordered[1]
}

/** Probability-sorted alternatives; duplicate token strings are merged by summing. */
export function buildAlternatives(pairs: Iterable<[string, number]>): Alternative[] {
  const merged = new Map<string, number>()
  for (const [token, logprob] of pairs) {
    merged.set(token, (merged.get(token) ?? 0) + logprobToProb(logprob))
  }
  return [...merged]
    .map(([token, prob]) => ({ token, prob, logprob: prob > 0 ? Math.log(prob) : -9999 }))
    .sort((a, b) => b.prob - a.prob)
}

/** A TokenInfo with prob, entropy and margin derived from its alternatives. */
export function annotateToken(
  token: string,
  logprob: number | null,
  top: Alternative[],
  forced = false,
): TokenInfo {
  const probs = top.map((a) => a.prob)
  return {
    token,
    logprob,
    prob: logprob === null ? null : logprobToProb(logprob),
    entropy: probs.length ? truncatedEntropy(probs) : 0,
    margin: probs.length ? top2Margin(probs) : 1,
    top,
    is_fork: false,
    fork_score: 0,
    forced,
  }
}

export const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
