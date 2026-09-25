import { describe, expect, it } from 'vitest'

import { sampleTree, tok } from '../test/fixtures'
import { forkScore, isFork, maxEntropy, remarkTree, truncatedEntropy } from './forks'

const S = { entropy_threshold: 1.5, margin_threshold: 0.15, min_alt_prob: 0.05 }

describe('fork detection (mirrors backend)', () => {
  it('computes max entropy with a tail bucket', () => {
    expect(maxEntropy(3)).toBeCloseTo(2)
  })

  it('computes truncated entropy with a tail bucket (matches backend)', () => {
    expect(truncatedEntropy([0.5, 0.5])).toBeCloseTo(1)
    expect(truncatedEntropy([0.5])).toBeCloseTo(1) // 0.5 observed + 0.5 tail
    expect(truncatedEntropy([1])).toBeCloseTo(0)
  })

  it('flags close calls but not confident tokens', () => {
    expect(isFork(tok('cat', { cat: 0.45, dog: 0.4, fox: 0.1 }), S)).toBe(true)
    expect(isFork(tok('the', { the: 0.97, a: 0.02 }), S)).toBe(false)
  })

  it('never flags forced tokens or implausible runner-ups', () => {
    expect(isFork(tok('cat', { cat: 0.5, dog: 0.5 }, { forced: true }), S)).toBe(false)
    expect(isFork(tok('a', { a: 0.2, b: 0.03, c: 0.02 }), S)).toBe(false)
  })

  it('scores uncertainty in [0, 1]', () => {
    const sure = forkScore(tok('a', { a: 0.9, b: 0.1 }))
    const torn = forkScore(tok('a', { a: 0.5, b: 0.49 }))
    expect(torn).toBeGreaterThan(sure)
    expect(sure).toBeGreaterThanOrEqual(0)
    expect(torn).toBeLessThanOrEqual(1)
  })

  it('re-marks a tree immutably when thresholds change', () => {
    const tree = sampleTree()
    const loose = remarkTree(tree, { ...S, margin_threshold: 1 })
    expect(loose).not.toBe(tree)
    expect(loose.nodes.root.tokens.some((t) => t.is_fork)).toBe(true)
    expect(tree.nodes.root.tokens.every((t) => !t.is_fork)).toBe(true)
    expect(loose.fork_settings.margin_threshold).toBe(1)
  })
})
