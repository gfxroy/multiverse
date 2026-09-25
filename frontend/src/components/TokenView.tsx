import clsx from 'clsx'
import { useEffect, useMemo } from 'react'

import { scaleColor } from '../lib/color'
import { branchedTokens, fullPath, lineage } from '../lib/tree'
import { useStore } from '../store'
import { TokenInspector } from './TokenInspector'
import { TokenStrip } from './TokenStrip'

export function TokenView() {
  const tree = useStore((s) => s.tree)
  const activeId = useStore((s) => s.activeId)
  const colorMode = useStore((s) => s.colorMode)
  const setColorMode = useStore((s) => s.setColorMode)
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const focus = useStore((s) => s.focus)
  const setFocus = useStore((s) => s.setFocus)
  const branch = useStore((s) => s.branch)
  const busy = useStore((s) => s.busy)

  const path = useMemo(() => (tree && activeId ? fullPath(tree, activeId) : []), [tree, activeId])
  const branched = useMemo(
    () => (tree && activeId ? branchedTokens(tree, activeId) : new Map<number, Set<string>>()),
    [tree, activeId],
  )
  const depth = tree && activeId ? lineage(tree, activeId).length - 1 : 0
  const active = tree && activeId ? tree.nodes[activeId] : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && select(null)
    const onClick = () => select(null)
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
    }
  }, [select])

  if (!tree || !active) {
    return (
      <section className="flex min-h-[220px] flex-col items-center justify-center panel p-8 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-neutral-300">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </div>
        <h2 className="text-sm font-medium text-white">Every token is a fork in the road</h2>
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-neutral-400">
          Generate a completion to explore token probabilities and alternate branches. Click any token to branch.
        </p>
      </section>
    )
  }

  const meanEntropy = path.reduce((a, t) => a + t.entropy, 0) / Math.max(path.length, 1)
  const forks = path.filter((t) => t.is_fork).length

  return (
    <section className="flex min-h-0 flex-col panel" data-testid="token-view">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/[0.08] px-5 py-3">
        <h2 className="panel-title">Completion</h2>
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span>{path.length} tokens</span>
          <span>·</span>
          <span>depth {depth}</span>
          <span>·</span>
          <span>H̄ {meanEntropy.toFixed(2)} b</span>
          <span>·</span>
          <span className="text-neutral-300">{forks} fork points</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Legend mode={colorMode} />
          <div className="flex rounded-lg border border-white/10 bg-white/[0.04] p-0.5 text-xs">
            {(['probability', 'entropy'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setColorMode(m)}
                className={clsx(
                  'rounded-md px-2.5 py-1 capitalize transition-all duration-150',
                  colorMode === m ? 'bg-white/15 text-white font-medium shadow-sm' : 'text-neutral-400 hover:text-white',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-3.5 flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs">
          <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 uppercase tracking-wider">
            Prompt
          </span>
          <p className="text-neutral-300 leading-relaxed">{tree.prompt}</p>
        </div>
        <TokenStrip
          tokens={path}
          colorMode={colorMode}
          selected={selected}
          focus={focus}
          onFocusHandled={() => setFocus(null)}
          onTokenClick={(position) => select(position)}
          renderPinned={(token) => (
            <TokenInspector
              token={token}
              position={token.position}
              pinned
              busy={busy !== null}
              branched={branched.get(token.position)}
              onChoose={(alt) => branch(token.position, alt)}
              onClose={() => select(null)}
            />
          )}
        />
        {active.finish_reason && (
          <span className="ml-1 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 align-middle text-[10px] text-neutral-400">
            {active.finish_reason === 'length' ? '… max tokens' : 'stop'}
          </span>
        )}
        {busy === 'branch' && (
          <div className="mt-3 text-xs text-neutral-400">Generating branch…</div>
        )}
      </div>
    </section>
  )
}

function Legend({ mode }: { mode: 'probability' | 'entropy' }) {
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => scaleColor(mode, t)).join(', ')
  return (
    <div className="hidden items-center gap-2 text-[10px] text-neutral-500 xl:flex">
      <span>{mode === 'probability' ? 'unlikely' : 'certain'}</span>
      <span
        className="h-1.5 w-16 rounded-full"
        style={{ background: `linear-gradient(90deg, ${stops})` }}
      />
      <span>{mode === 'probability' ? 'likely' : 'uncertain'}</span>
    </div>
  )
}
