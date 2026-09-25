import { describe, expect, it } from 'vitest'

import {
  buildAlternatives,
  logprobToProb,
  maxEntropy,
  tailMass,
  top2Margin,
  truncatedEntropy,
} from './entropy'

describe('entropy (mirrors backend/tests/test_entropy.py)', () => {
  it('is zero for a certain distribution and one bit for a fair coin', () => {
    expect(truncatedEntropy([1])).toBeCloseTo(0)
    expect(truncatedEntropy([0.5, 0.5])).toBeCloseTo(1)
    expect(truncatedEntropy([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(2)
  })

  it('counts the unobserved tail as one extra outcome', () => {
    expect(tailMass([0.5, 0.25])).toBeCloseTo(0.25)
    expect(truncatedEntropy([0.5, 0.25])).toBeCloseTo(1.5)
  })

  it('is a lower bound of the full entropy', () => {
    const full = [0.4, 0.3, 0.1, 0.1, 0.1]
    expect(truncatedEntropy(full.slice(0, 2))).toBeLessThanOrEqual(truncatedEntropy(full) + 1e-9)
  })

  it('renormalises inputs that sum to more than one', () => {
    expect(truncatedEntropy([1, 1])).toBeCloseTo(1)
  })

  it('computes margins and the max entropy with a tail bucket', () => {
    expect(top2Margin([0.2, 0.7, 0.1])).toBeCloseTo(0.5)
    expect(top2Margin([0.6])).toBeCloseTo(0.6)
    expect(top2Margin([])).toBe(1)
    expect(maxEntropy(3)).toBeCloseTo(2)
  })

  it('clamps probabilities and sorts/merges alternatives', () => {
    expect(logprobToProb(0.5)).toBe(1)
    const alts = buildAlternatives([
      ['a', Math.log(0.1)],
      ['b', Math.log(0.5)],
      ['a', Math.log(0.2)],
    ])
    expect(alts.map((x) => x.token)).toEqual(['b', 'a'])
    expect(alts[1].prob).toBeCloseTo(0.3)
    expect(buildAlternatives([['x', -1e6]])[0].logprob).toBe(-9999)
  })
})
