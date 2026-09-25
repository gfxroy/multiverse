import { describe, expect, it } from 'vitest'

import { pct, tokenColor, visibleToken } from './color'

describe('colour scales', () => {
  it('makes unlikely tokens more saturated than likely ones', () => {
    const alpha = (c: string) => Number(c.match(/([\d.]+)\)$/)![1])
    expect(alpha(tokenColor('probability', 0.05, 0))).toBeGreaterThan(
      alpha(tokenColor('probability', 0.95, 0)),
    )
    expect(alpha(tokenColor('entropy', null, 3))).toBeGreaterThan(
      alpha(tokenColor('entropy', null, 0.1)),
    )
  })

  it('uses a neutral colour for custom tokens without a probability', () => {
    expect(tokenColor('probability', null, 0)).toContain('148, 163, 184')
  })

  it('renders whitespace visibly', () => {
    expect(visibleToken(' the\n')).toBe('␣the⏎')
    expect(visibleToken('')).toBe('∅')
    expect(pct(0.1234)).toBe('12.3%')
    expect(pct(null)).toBe('—')
  })
})
