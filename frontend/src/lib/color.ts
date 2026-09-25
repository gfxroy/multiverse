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
    if (prob === null) return 'rgba(148, 163, 184, 0.18)' // custom token: neutral
    // 0 -> rose (350deg), 1 -> emerald (150deg)
    const p = clamp01(prob)
    const hue = 350 + (150 + 360 - 350) * p
    const alpha = 0.12 + 0.38 * (1 - p)
    return `hsla(${hue % 360}, 85%, 55%, ${alpha.toFixed(3)})`
  }
  const e = clamp01(entropy / maxEntropy)
  // calm (indigo, faint) -> hot (amber, strong)
  const hue = 250 - 210 * e
  const alpha = 0.06 + 0.5 * e
  return `hsla(${hue}, 90%, 60%, ${alpha.toFixed(3)})`
}

/** Solid colour for bars/legends at the same scale. */
export function scaleColor(mode: ColorMode, t: number): string {
  const v = clamp01(t)
  if (mode === 'probability') return `hsl(${(350 + 160 * v) % 360}, 85%, 60%)`
  return `hsl(${250 - 210 * v}, 90%, 62%)`
}

/** Render whitespace so it is visible in tooltips and chips. */
export function visibleToken(token: string): string {
  if (token === '') return '∅'
  return token.replace(/\n/g, '⏎').replace(/\t/g, '⇥').replace(/ /g, '␣')
}

export const pct = (p: number | null | undefined, digits = 1) =>
  p === null || p === undefined ? '—' : `${(p * 100).toFixed(digits)}%`
