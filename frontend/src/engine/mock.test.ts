import { describe, expect, it } from 'vitest'

import { MockProvider, tokenize } from './mock'
import { settings } from './testing'

const PROMPT = 'Write a short story about a lighthouse keeper.'
const mock = new MockProvider(0)
const words = (r: { tokens: { token: string }[] }) => r.tokens.map((t) => t.token)

describe('mock provider (mirrors backend/tests/test_mock_provider.py)', () => {
  it('tokenizes with GPT-style leading spaces', () => {
    expect(tokenize('Hello world, again.')).toEqual(['Hello', ' world', ',', ' again', '.'])
  })

  it('is deterministic', async () => {
    const s = settings({ temperature: 0.9, max_tokens: 30 })
    const [a, b] = [await mock.complete(PROMPT, s), await mock.complete(PROMPT, s)]
    expect(words(a)).toEqual(words(b))
    expect(a.method).toBe('mock')
  })

  it('produces well-formed logprobs', async () => {
    const r = await mock.complete(
      PROMPT,
      settings({ temperature: 0.7, max_tokens: 40, top_logprobs: 7 }),
    )
    expect(r.tokens.length).toBeGreaterThan(0)
    expect(r.tokens.length).toBeLessThanOrEqual(40)
    for (const t of r.tokens) {
      expect(t.top).toHaveLength(7)
      const probs = t.top.map((a) => a.prob)
      expect(probs).toEqual([...probs].sort((x, y) => y - x))
      expect(probs.reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(1 + 1e-9)
      expect(t.logprob).not.toBeNull()
      expect(t.logprob!).toBeLessThanOrEqual(0)
      expect(t.prob).toBeCloseTo(Math.exp(t.logprob!))
      expect(t.entropy).toBeGreaterThanOrEqual(0)
    }
  })

  it('greedy decoding picks the most likely token, without a leading space at the start', async () => {
    const r = await mock.complete(PROMPT, settings({ temperature: 0, max_tokens: 25 }))
    for (const t of r.tokens) expect(t.token.trim()).toBe(t.top[0].token.trim())
    expect(r.tokens[0].token.startsWith(' ')).toBe(false)
  })

  it('stays on topic and writes readable text', async () => {
    const r = await mock.complete(PROMPT, settings({ temperature: 0, max_tokens: 30 }))
    const text = words(r).join('')
    expect(text).toMatch(/lighthouse|keeper|sea|storm|light|ship/i)
  })

  it('changes the continuation when the prefix changes', async () => {
    const s = settings({ temperature: 0, max_tokens: 15 })
    const a = await mock.complete(PROMPT, s, 'The old lighthouse')
    const b = await mock.complete(PROMPT, s, 'The city')
    expect(words(a)).not.toEqual(words(b))
  })

  it('gives each model name its own "personality"', async () => {
    const a = await mock.complete(PROMPT, settings({ model: 'm1', max_tokens: 10 }))
    const b = await mock.complete(PROMPT, settings({ model: 'm2', max_tokens: 10 }))
    expect(a.tokens.map((x) => x.top[0].prob)).not.toEqual(b.tokens.map((x) => x.top[0].prob))
  })

  it('respects max_tokens', async () => {
    const r = await mock.complete(PROMPT, settings({ max_tokens: 3 }))
    expect(r.tokens).toHaveLength(3)
    expect(r.finish_reason).toBe('length')
  })
})
