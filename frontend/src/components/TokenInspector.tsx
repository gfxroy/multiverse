import clsx from 'clsx'
import { useState } from 'react'

import { pct, visibleToken } from '../lib/color'
import type { TokenInfo } from '../lib/types'
import { BranchIcon } from './Icons'

interface Props {
  token: TokenInfo
  position: number
  pinned?: boolean
  branched?: Set<string>
  busy?: boolean
  onChoose?: (token: string) => void
  onClose?: () => void
}

/** Tooltip (hover) and branch menu (pinned) showing a position's top alternatives. */
export function TokenInspector({
  token,
  position,
  pinned,
  branched,
  busy,
  onChoose,
  onClose,
}: Props) {
  const [custom, setCustom] = useState('')
  const maxProb = Math.max(...token.top.map((a) => a.prob), 0.0001)

  return (
    <div
      className={clsx(
        'w-80 animate-fade-in rounded-xl border border-white/10 bg-ink-850/95 p-3 text-xs shadow-2xl shadow-black/60 backdrop-blur-xl',
        pinned && 'ring-1 ring-violet-400/40',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] tracking-widest text-slate-500 uppercase">
            Token #{position}
            {token.forced && <span className="ml-2 text-cyan-300">forced</span>}
            {token.is_fork && <span className="ml-2 text-amber-300">fork point</span>}
          </div>
          <div className="mt-0.5 truncate font-mono text-base text-white">
            {visibleToken(token.token)}
          </div>
        </div>
        {pinned && (
          <button
            className="rounded-md px-1.5 text-slate-500 hover:bg-white/10 hover:text-white"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        )}
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <Stat label="prob" value={pct(token.prob)} />
        <Stat label="entropy" value={`${token.entropy.toFixed(2)} b`} />
        <Stat label="top-2 margin" value={pct(token.margin)} />
      </div>

      <div className="mb-1 text-[10px] tracking-widest text-slate-500 uppercase">
        {pinned ? 'Branch on an alternative' : 'Alternatives the model considered'}
      </div>
      {!token.top.some((a) => a.token === token.token) && (
        <p className="mb-1 text-[10px] text-slate-500">
          The sampled token is outside the top {token.top.length} shown.
        </p>
      )}
      <ul className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
        {token.top.map((alt) => {
          const chosen = alt.token === token.token
          const explored = branched?.has(alt.token)
          return (
            <li key={alt.token}>
              <button
                disabled={!pinned || busy || chosen}
                onClick={() => onChoose?.(alt.token)}
                className={clsx(
                  'group relative flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-left',
                  pinned && !chosen && 'hover:bg-violet-500/15',
                  chosen && 'bg-white/[0.06]',
                  !pinned && 'cursor-default',
                )}
              >
                <span
                  className={clsx(
                    'absolute inset-y-0 left-0 rounded-md',
                    chosen ? 'bg-emerald-400/20' : 'bg-violet-400/15',
                  )}
                  style={{ width: `${(alt.prob / maxProb) * 100}%` }}
                />
                <span className="relative flex-1 truncate font-mono text-slate-100">
                  {visibleToken(alt.token)}
                </span>
                {chosen && <span className="relative text-[10px] text-emerald-300">chosen</span>}
                {explored && !chosen && (
                  <span className="relative text-cyan-300" title="Already explored">
                    <BranchIcon className="h-3 w-3" />
                  </span>
                )}
                <span className="relative w-12 text-right text-slate-400 tabular-nums">
                  {pct(alt.prob)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {pinned && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (custom) onChoose?.(custom)
          }}
        >
          <input
            className="input py-1.5 font-mono text-xs"
            placeholder="or force your own token, e.g. ␣dragon"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            aria-label="Custom token"
          />
          <button className="btn-primary px-3 py-1 text-xs" disabled={!custom || busy}>
            Branch
          </button>
        </form>
      )}
      {pinned && (
        <p className="mt-2 text-[10px] text-slate-500">
          Tip: include a leading space for a new word. Custom tokens have no logprob.
        </p>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
      <div className="text-[9px] tracking-wider text-slate-500 uppercase">{label}</div>
      <div className="font-mono text-[13px] text-slate-100 tabular-nums">{value}</div>
    </div>
  )
}
