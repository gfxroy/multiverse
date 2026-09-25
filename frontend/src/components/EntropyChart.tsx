import { useState } from 'react'

import type { TokenInfo } from '../lib/types'

interface Series {
  label: string
  color: string
  tokens: TokenInfo[]
}

const W = 900
const H = 200
const PAD = { l: 36, r: 12, t: 12, b: 24 }

/** Per-token entropy for two sequences, with the first divergence marked. */
export function EntropyChart({
  series,
  divergence,
}: {
  series: Series[]
  divergence: number | null
}) {
  const [cursor, setCursor] = useState<number | null>(null)
  const n = Math.max(...series.map((s) => s.tokens.length), 1)
  const maxH = Math.max(1, ...series.flatMap((s) => s.tokens.map((t) => t.entropy)))
  const x = (i: number) => PAD.l + (i / Math.max(n - 1, 1)) * (W - PAD.l - PAD.r)
  const y = (h: number) => PAD.t + (1 - h / maxH) * (H - PAD.t - PAD.b)
  const ticks = [0, maxH / 2, maxH]

  return (
    <div className="relative">
      <div className="mb-2 flex items-center gap-4 text-[11px] text-slate-400">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
            {cursor !== null && s.tokens[cursor] && (
              <span className="font-mono text-slate-200">
                {s.tokens[cursor].entropy.toFixed(2)}b “{s.tokens[cursor].token}”
              </span>
            )}
          </span>
        ))}
        {cursor !== null && <span className="ml-auto font-mono">token #{cursor}</span>}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[200px] w-full"
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))
          setCursor(Math.min(n - 1, Math.max(0, i)))
        }}
        onMouseLeave={() => setCursor(null)}
        role="img"
        aria-label="Per-token entropy chart"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#ffffff10" />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#64748b">
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        {divergence !== null && divergence < n && (
          <g>
            <line
              x1={x(divergence)}
              x2={x(divergence)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="#fb7185"
              strokeDasharray="4 4"
            />
            <text x={x(divergence) + 4} y={PAD.t + 10} fontSize="10" fill="#fb7185">
              first divergence #{divergence}
            </text>
          </g>
        )}
        {series.map((s) => {
          const pts = s.tokens.map((t, i) => `${x(i)},${y(t.entropy)}`).join(' ')
          const area = s.tokens.length
            ? `${x(0)},${y(0)} ${pts} ${x(s.tokens.length - 1)},${y(0)}`
            : ''
          return (
            <g key={s.label}>
              <polygon points={area} fill={s.color} opacity={0.08} />
              <polyline
                points={pts}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}
        {cursor !== null && (
          <line x1={x(cursor)} x2={x(cursor)} y1={PAD.t} y2={H - PAD.b} stroke="#ffffff40" />
        )}
        <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize="10" fill="#64748b">
          token index →
        </text>
        <text x={PAD.l} y={H - 6} fontSize="10" fill="#64748b">
          bits
        </text>
      </svg>
    </div>
  )
}
