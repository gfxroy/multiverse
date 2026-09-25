import { describe, expect, it } from 'vitest'

import { lineage } from '../lib/tree'
import type { GenerationSettings, ProviderResult, Tree } from '../lib/types'
import { MockProvider } from './mock'
import {
  branch,
  createTree,
  explore,
  forcedToken,
  fullTokens,
  ownerOf,
  tokensText,
  TreeError,
  type Provider,
} from './tree'
import { forkSettings, makeToken, settings } from './testing'

/** Returns fixed tokens and remembers the prefixes it was asked to continue. */
class RecordingProvider implements Provider {
  name = 'recording'
  prefixes: string[] = []
  async complete(_p: string, s: GenerationSettings, prefix = ''): Promise<ProviderResult> {
    this.prefixes.push(prefix)
    const tokens = [
      makeToken(' X', { ' X': 0.6, ' Y': 0.3 }),
      makeToken('.', { '.': 0.9, '!': 0.1 }),
    ]
    return { tokens, model: s.model, method: 'mock', finish_reason: null }
  }
}

function rootTree(): Tree {
  const tokens = [
    makeToken('The', { The: 0.9, A: 0.1 }),
    makeToken(' cat', { ' cat': 0.45, ' dog': 0.42, ' fox': 0.1 }),
    makeToken(' sat', { ' sat': 0.8, ' ran': 0.2 }),
    makeToken('.', { '.': 0.95, '!': 0.05 }),
  ]
  const result: ProviderResult = { tokens, model: 'm', method: 'mock', finish_reason: 'stop' }
  return createTree('p', settings(), forkSettings, result, 'recording')
}

describe('branching (mirrors backend/tests/test_tree.py)', () => {
  it('creates a child with the forced token and the correct prefix', async () => {
    const tree = rootTree()
    const provider = new RecordingProvider()
    const [id, created] = await branch(tree, tree.root_id, 1, ' dog', provider)
    expect(created).toBe(true)
    expect(provider.prefixes).toEqual(['The dog'])
    const child = tree.nodes[id]
    expect(child.parent_id).toBe(tree.root_id)
    expect(child.fork_index).toBe(1)
    expect(child.tokens[0]).toMatchObject({ token: ' dog', forced: true })
    expect(child.tokens[0].top.slice(0, 2).map((a) => a.token)).toEqual([' cat', ' dog'])
    expect(child.tokens[0].prob).toBeCloseTo(0.42)
    expect(tokensText(fullTokens(tree, id))).toBe('The dog X.')
    expect(tree.nodes[tree.root_id].children).toEqual([id])
  })

  it('gives a custom token no logprob', async () => {
    const tree = rootTree()
    const [id] = await branch(tree, tree.root_id, 2, ' flew', new RecordingProvider())
    expect(tree.nodes[id].tokens[0].logprob).toBeNull()
  })

  it('is idempotent, and choosing the same token is a no-op', async () => {
    const tree = rootTree()
    const provider = new RecordingProvider()
    const [first] = await branch(tree, tree.root_id, 1, ' dog', provider)
    const [second, created] = await branch(tree, tree.root_id, 1, ' dog', provider)
    expect(second).toBe(first)
    expect(created).toBe(false)
    const [same, created2] = await branch(tree, tree.root_id, 1, ' cat', provider)
    expect(same).toBe(tree.root_id)
    expect(created2).toBe(false)
    expect(provider.prefixes).toHaveLength(1)
  })

  it('attaches a branch at an ancestor position to the node that owns it', async () => {
    const tree = rootTree()
    const provider = new RecordingProvider()
    const [child] = await branch(tree, tree.root_id, 2, ' ran', provider)
    expect(ownerOf(tree, child, 0)).toBe(tree.root_id)
    expect(ownerOf(tree, child, 3)).toBe(child)
    const [grand] = await branch(tree, child, 0, 'A', provider)
    expect(tree.nodes[grand].parent_id).toBe(tree.root_id)
    const [nested] = await branch(tree, child, 3, ' Y', provider)
    expect(tree.nodes[nested].parent_id).toBe(child)
    expect(provider.prefixes.at(-1)).toBe('The cat ran Y')
  })

  it('rejects out-of-range positions, unknown nodes and cycles', async () => {
    const tree = rootTree()
    await expect(branch(tree, tree.root_id, 99, 'x', new RecordingProvider())).rejects.toThrow(
      TreeError,
    )
    expect(() => fullTokens(tree, 'missing')).toThrow(TreeError)
    tree.nodes[tree.root_id].parent_id = tree.root_id
    expect(() => lineage(tree, tree.root_id)).toThrow(/Cycle/)
  })

  it('forced tokens copy the distribution of the position they replace', () => {
    const original = makeToken(' cat', { ' cat': 0.5, ' dog': 0.3 })
    const forced = forcedToken(original, ' dog')
    expect(forced.forced).toBe(true)
    expect(forced.entropy).toBeCloseTo(original.entropy)
  })
})

describe('auto-explore', () => {
  it('expands fork points breadth-first, one new alternative per run', async () => {
    const tree = rootTree()
    const provider = new RecordingProvider()
    const [created, truncated] = await explore(tree, tree.root_id, provider, { topK: 2, depth: 1 })
    expect(truncated).toBe(false)
    expect(created).toHaveLength(1) // only " cat" is a fork in the root
    expect(tree.nodes[created[0]].tokens[0].token).toBe(' dog')
    const [again] = await explore(tree, tree.root_id, provider, { topK: 1, depth: 1 })
    expect(tree.nodes[again[0]].tokens[0].token).toBe(' fox')
  })

  it('respects the node budget and keeps the tree consistent', async () => {
    const s = settings({ temperature: 0, max_tokens: 30 })
    const provider = new MockProvider(0)
    const prompt = 'Tell me a story about the sea'
    const tree = createTree(prompt, s, forkSettings, await provider.complete(prompt, s), 'mock')
    const [created, truncated] = await explore(tree, tree.root_id, provider, {
      topK: 3,
      depth: 3,
      maxNodes: 4,
    })
    expect(created.length).toBeLessThanOrEqual(4)
    expect(truncated).toBe(true)
    for (const id of created) {
      const node = tree.nodes[id]
      expect(tree.nodes[node.parent_id!].children).toContain(id)
    }
  })
})
