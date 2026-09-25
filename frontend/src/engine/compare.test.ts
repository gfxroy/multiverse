import { describe, expect, it } from 'vitest'

import { divergenceMetrics, firstDivergence } from './compare'
import { makeToken } from './testing'

const seq = (...words: string[]) => words.map((w) => makeToken(w, { [w]: 0.6, '?': 0.4 }))

describe('compare metrics (mirrors backend/tests/test_compare.py)', () => {
  it('identical sequences have no divergence', () => {
    const m = divergenceMetrics(seq('a', 'b'), seq('a', 'b'))
    expect(m.first_divergence_index).toBeNull()
    expect(m.shared_prefix_tokens).toBe(2)
    expect(m.position_agreement).toBe(1)
    expect(m.mean_abs_entropy_delta).toBe(0)
  })

  it('finds the first differing token', () => {
    const m = divergenceMetrics(seq('a', 'b', 'c'), seq('a', 'x', 'c'))
    expect(m.first_divergence_index).toBe(1)
    expect(m.position_agreement).toBeCloseTo(2 / 3)
  })

  it('a prefix of the other diverges at the shorter length', () => {
    expect(firstDivergence(seq('a', 'b'), seq('a', 'b', 'c'))).toBe(2)
  })

  it('handles empty sequences', () => {
    const m = divergenceMetrics([], [])
    expect(m.first_divergence_index).toBeNull()
    expect(m.position_agreement).toBe(1)
  })
})
