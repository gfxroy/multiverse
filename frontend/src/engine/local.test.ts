import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { setByok } from '../lib/byok'
import { fullPath } from '../lib/tree'
import { LIMITS, localApi, setMockProvider } from './local'
import { MockProvider } from './mock'
import { forkSettings, settings } from './testing'

const PROMPT = 'Write a short story about a lighthouse keeper.'

beforeAll(() => setMockProvider(new MockProvider(0)))
afterEach(() => {
  setByok(null)
  vi.unstubAllGlobals()
})

describe('in-browser API (static GitHub Pages mode)', () => {
  it('reports demo mode and OpenAI-only own keys', async () => {
    const c = await localApi.config()
    expect(c).toMatchObject({ provider: 'mock', demo_mode: true, byok_providers: ['openai'] })
  })

  it('generates, branches, explores and compares without a backend', async () => {
    const tree = await localApi.generate(
      PROMPT,
      settings({ temperature: 0, max_tokens: 40 }),
      forkSettings,
    )
    expect(tree.provider).toBe('mock')
    const root = tree.nodes[tree.root_id]
    expect(root.tokens.length).toBeGreaterThan(0)
    expect(root.tokens.some((t) => t.is_fork)).toBe(true)

    const pos = root.tokens.findIndex((t) => t.top.length > 1)
    const alt = root.tokens[pos].top.find((a) => a.token !== root.tokens[pos].token)!.token
    const res = await localApi.branch(tree, tree.root_id, pos, alt)
    expect(res.created).toBe(true)
    expect(Object.keys(tree.nodes)).toHaveLength(1) // the input tree is not mutated
    expect(fullPath(res.tree, res.node_id)[pos]).toMatchObject({ token: alt, forced: true })

    const ex = await localApi.explore(res.tree, res.tree.root_id, 2, 2)
    expect(ex.created.length).toBeGreaterThan(0)
    expect(ex.created.length).toBeLessThanOrEqual(LIMITS.maxExploreNodesDemo)

    const cmp = await localApi.compare(
      PROMPT,
      { model: 'gpt-4o-mini', temperature: 0 },
      { model: 'gpt-4o', temperature: 1.2 },
      30,
      5,
      forkSettings,
    )
    expect(cmp.a.tokens.length).toBeGreaterThan(0)
    expect(cmp.metrics.position_agreement).toBeLessThanOrEqual(1)
  })

  it('caps max_tokens and rejects oversized prompts', async () => {
    const tree = await localApi.generate(
      PROMPT,
      settings({ max_tokens: 5000, top_logprobs: 50 }),
      forkSettings,
    )
    expect(tree.settings.max_tokens).toBe(LIMITS.maxTokens)
    expect(tree.settings.top_logprobs).toBe(LIMITS.maxTopLogprobs)
    await expect(
      localApi.generate('x'.repeat(LIMITS.maxPromptChars + 1), settings(), forkSettings),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('with an own OpenAI key, calls only api.openai.com and caps auto-explore', async () => {
    const hosts: string[] = []
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        hosts.push(new URL(url).host)
        n++
        const tok = (t: string) => ({
          token: t,
          logprob: -0.7,
          top_logprobs: [
            { token: t, logprob: -0.7 },
            { token: ` alt${n}`, logprob: -0.8 },
            { token: ' other', logprob: -2 },
          ],
        })
        return new Response(
          JSON.stringify({
            model: 'gpt-4o-mini',
            choices: [
              { finish_reason: 'stop', logprobs: { content: [tok('A'), tok(' b'), tok(' c')] } },
            ],
          }),
        )
      }),
    )
    setByok({ provider: 'openai', key: 'sk-visitor' })
    const c = await localApi.config()
    expect(c).toMatchObject({ provider: 'openai', demo_mode: false })
    const tree = await localApi.generate(PROMPT, settings(), forkSettings)
    expect(tree.provider).toBe('openai')
    const ex = await localApi.explore(tree, tree.root_id, 5, 3)
    expect(ex.created.length).toBeLessThanOrEqual(LIMITS.maxExploreNodesOwnKey)
    expect(new Set(hosts)).toEqual(new Set(['api.openai.com']))
  })
})
