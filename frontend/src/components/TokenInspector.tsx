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
        'w-80 animate-fade-in rounded-2xl border border-white/10 bg-[#161618]/95 p-4 text-xs shadow-2xl backdrop-blur-2xl',
        pinned && 'ring-1 ring-white/30',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] tracking-wider text-neutral-400 uppercase">
            Token #{position}
            {token.forced && <span className="ml-2 text-neutral-300">forced</span>}
            {token.is_fork && <span className="ml-2 text-amber-400/90">fork point</span>}
          </div>
          <div className="mt-0.5 truncate font-mono text-sm font-medium text-white">
            {visibleToken(token.token)}
          </div>
        </div>
        {pinned && (
          <button
            className="rounded-lg p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
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
        <Stat label="margin" value={pct(token.margin)} />
      </div>

      <div className="mb-1 text-[10px] tracking-wider text-neutral-400 uppercase">
        {pinned ? 'Branch on an alternative' : 'Alternatives considered'}
      </div>
      {!token.top.some((a) => a.token === token.token) && (
        <p className="mb-1 text-[10px] text-neutral-500">
          The sampled token is outside the top {token.top.length} shown.
        </p>
      )}
      <ul className="max-h-60 space-y-0.5 overflow-y-auto pr-1">
        {token.top.map((alt) => {
          const chosen = alt.token === token.token
          const explored = branched?.has(alt.token)
          return (
            <li key={alt.token}>
              <button
                disabled={!pinned || busy || chosen}
                onClick={() => onChoose?.(alt.token)}
                className={clsx(
                  'group relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-2.5 py-1 text-left transition-all',
                  pinned && !chosen && 'hover:bg-white/10',
                  chosen && 'bg-white/[0.08]',
                  !pinned && 'cursor-default',
                )}
              >
                <span
                  className={clsx(
                    'absolute inset-y-0 left-0 rounded-lg',
                    chosen ? 'bg-white/15' : 'bg-white/[0.06]',
                  )}
                  style={{ width: `${(alt.prob / maxProb) * 100}%` }}
                />
                <span className="relative flex-1 truncate font-mono text-neutral-100">
                  {visibleToken(alt.token)}
                </span>
                {chosen && <span className="relative text-[10px] text-neutral-400 font-medium">chosen</span>}
                {explored && !chosen && (
                  <span className="relative text-neutral-400" title="Already explored">
                    <BranchIcon className="h-3 w-3" />
                  </span>
                )}
                <span className="relative w-12 text-right text-neutral-400 tabular-nums">
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
            placeholder="or type token, e.g. ␣dragon"
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
        <p className="mt-2 text-[10px] text-neutral-500">
          Tip: include leading space for a new word.
        </p>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5">
      <div className="text-[9px] tracking-wider text-neutral-400 uppercase">{label}</div>
      <div className="font-mono text-[12px] font-medium text-neutral-100 tabular-nums">{value}</div>
    </div>
  )
}
