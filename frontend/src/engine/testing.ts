// Test helpers shared by the engine tests (mirrors backend/tests/conftest.py).
import type { GenerationSettings, TokenInfo } from '../lib/types'
import { annotateToken } from './entropy'

export function makeToken(token: string, probs: Record<string, number>, forced = false): TokenInfo {
  const top = Object.entries(probs)
    .map(([t, p]) => ({ token: t, prob: p, logprob: Math.log(p) }))
    .sort((a, b) => b.prob - a.prob)
  return annotateToken(token, token in probs ? Math.log(probs[token]) : null, top, forced)
}

export const settings = (patch: Partial<GenerationSettings> = {}): GenerationSettings => ({
  model: 'gpt-4o-mini',
  temperature: 1,
  max_tokens: 80,
  top_logprobs: 10,
  ...patch,
})

export const forkSettings = { entropy_threshold: 1.5, margin_threshold: 0.15, min_alt_prob: 0.05 }
