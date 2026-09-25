export type ColorMode = 'probability' | 'entropy'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Background for a token chip. Low probability / high entropy = hotter colour. */
export function tokenColor(
  mode: ColorMode,
  prob: number | null,
  entropy: number,
  maxEntropy = 3,
): string {
  if (mode === 'probability') {
    if (prob === null) return 'rgba(148, 163, 184, 0.15)' // custom token: neutral
    const p = clamp01(prob)
    // Apple-style subtle hue shift: soft rose (350deg) for low prob to soft mint/slate (160deg) for high prob
    const hue = (350 + 170 * p) % 360
    const alpha = 0.03 + 0.22 * (1 - p)
    return `hsla(${hue.toFixed(0)}, 65%, 52%, ${alpha.toFixed(3)})`
  }
  const e = clamp01(entropy / maxEntropy)
  // Subtle calm neutral (220deg) to soft warm amber (35deg)
  const hue = 220 - 185 * e
  const alpha = 0.02 + 0.22 * e
  return `hsla(${hue.toFixed(0)}, 60%, 54%, ${alpha.toFixed(3)})`
}

/** Solid colour for bars/legends at the same scale. */
export function scaleColor(mode: ColorMode, t: number): string {
  const v = clamp01(t)
  if (mode === 'probability') return `hsl(${((350 + 170 * v) % 360).toFixed(0)}, 65%, 52%)`
  return `hsl(${(220 - 185 * v).toFixed(0)}, 60%, 54%)`
}

/** Render whitespace so it is visible in tooltips and chips. */
export function visibleToken(token: string): string {
  if (token === '') return '∅'
  return token.replace(/\n/g, '⏎').replace(/\t/g, '⇥').replace(/ /g, '␣')
}

export const pct = (p: number | null | undefined, digits = 1) =>
  p === null || p === undefined ? '—' : `${(p * 100).toFixed(digits)}%`
