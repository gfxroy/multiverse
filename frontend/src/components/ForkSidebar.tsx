import { useMemo, useState } from 'react'

import { pct, visibleToken } from '../lib/color'
import { branchedTokens, forkPoints, fullPath } from '../lib/tree'
import { useStore } from '../store'
import { BranchIcon } from './Icons'
import { Slider } from './ModelInput'
import { Spinner } from './PromptPanel'

export function ForkSidebar() {
  const tree = useStore((s) => s.tree)
  const activeId = useStore((s) => s.activeId)
  const setFocus = useStore((s) => s.setFocus)
  const explore = useStore((s) => s.explore)
  const busy = useStore((s) => s.busy)
  const forkSettings = useStore((s) => s.forkSettings)
  const updateForkSettings = useStore((s) => s.updateForkSettings)
  const [topK, setTopK] = useState(2)
  const [depth, setDepth] = useState(2)

  const forks = useMemo(
    () => (tree && activeId ? forkPoints(fullPath(tree, activeId)) : []),
    [tree, activeId],
  )
  const branched = useMemo(
    () => (tree && activeId ? branchedTokens(tree, activeId) : new Map<number, Set<string>>()),
    [tree, activeId],
  )
  const maxCalls = Array.from({ length: depth }, (_, i) => topK ** (i + 1)).reduce(
    (a, b) => a + b,
    0,
  )

  return (
    <aside className="flex min-h-0 flex-col gap-4">
      <section className="flex min-h-0 flex-1 flex-col panel" data-testid="fork-sidebar">
        <header className="border-b border-white/5 px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="panel-title">Fork points</h2>
            <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
              {forks.length}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-slate-500">
            Where the model was torn: entropy ≥ {forkSettings.entropy_threshold.toFixed(1)} bits or
            top-2 margin ≤ {pct(forkSettings.margin_threshold, 0)}.
          </p>
        </header>
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {forks.length === 0 && (
            <li className="p-4 text-center text-xs text-slate-600">
              {tree ? 'No fork points on this branch. The model was confident.' : 'Nothing yet.'}
            </li>
          )}
          {forks.map(({ position, token }) => {
            const [first, second] = token.top
            const explored = branched.get(position)?.size ?? 0
            return (
              <li key={position}>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setFocus(position)
                  }}
                  className="group w-full rounded-lg border border-transparent px-2.5 py-2 text-left transition hover:border-amber-400/30 hover:bg-amber-400/[0.06]"
                >
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <span>#{position}</span>
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
                      <span
                        className="block h-full rounded-full bg-gradient-to-r from-amber-500 to-rose-500"
                        style={{ width: `${Math.round(token.fork_score * 100)}%` }}
                      />
                    </span>
                    <span className="font-mono">{token.entropy.toFixed(2)}b</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-1.5 font-mono text-xs">
                    <span className="truncate text-slate-100">
                      {visibleToken(first?.token ?? '')}
                    </span>
                    <span className="text-slate-500">{pct(first?.prob, 0)}</span>
                    <span className="text-slate-600">vs</span>
                    <span className="truncate text-slate-300">
                      {visibleToken(second?.token ?? '')}
                    </span>
                    <span className="text-slate-500">{pct(second?.prob, 0)}</span>
                    {explored > 0 && (
                      <span
                        className="ml-auto flex items-center gap-0.5 text-cyan-300"
                        title={`${explored} explored`}
                      >
                        <BranchIcon className="h-3 w-3" />
                        {explored}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="space-y-3 panel p-4">
        <h2 className="panel-title">Auto-explore</h2>
        <p className="text-[11px] leading-snug text-slate-500">
          Branch the top-k fork points of the current branch with their best unexplored alternative,
          then repeat on the new branches.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Slider label="top-k" value={topK} min={1} max={4} step={1} onChange={setTopK} />
          <Slider label="depth" value={depth} min={1} max={3} step={1} onChange={setDepth} />
        </div>
        <button
          className="btn-ghost w-full border-amber-400/30 text-amber-200 hover:border-amber-400/60"
          disabled={!tree || busy !== null}
          onClick={() => explore(topK, depth)}
        >
          {busy === 'explore' ? (
            <>
              <Spinner /> Exploring…
            </>
          ) : (
            <>
              <BranchIcon /> Auto-explore
            </>
          )}
        </button>
        <p className="text-center text-[10px] text-slate-600">
          up to {maxCalls} model calls (server caps nodes per run)
        </p>
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer text-[11px] text-slate-500 select-none hover:text-slate-300">
            Fork thresholds
          </summary>
          <div className="mt-3 space-y-3">
            <Slider
              label="Entropy ≥ (bits)"
              value={forkSettings.entropy_threshold}
              min={0.25}
              max={4}
              step={0.05}
              onChange={(v) => updateForkSettings({ entropy_threshold: v })}
              format={(v) => v.toFixed(2)}
            />
            <Slider
              label="Top-2 margin ≤"
              value={forkSettings.margin_threshold}
              min={0}
              max={0.6}
              step={0.01}
              onChange={(v) => updateForkSettings({ margin_threshold: v })}
              format={(v) => pct(v, 0)}
            />
            <Slider
              label="Runner-up ≥"
              value={forkSettings.min_alt_prob}
              min={0}
              max={0.4}
              step={0.01}
              onChange={(v) => updateForkSettings({ min_alt_prob: v })}
              format={(v) => pct(v, 0)}
            />
          </div>
        </details>
      </section>
    </aside>
  )
}
