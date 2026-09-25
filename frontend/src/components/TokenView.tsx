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
        <div className="mb-3 text-4xl">🌌</div>
        <h2 className="text-lg font-semibold text-white">Every token is a fork in the road</h2>
        <p className="mt-2 max-w-md text-sm text-slate-400">
          Generate a completion to see the probability of every token and the alternatives the model
          almost chose. Click any token to branch the multiverse.
        </p>
      </section>
    )
  }

  const meanEntropy = path.reduce((a, t) => a + t.entropy, 0) / Math.max(path.length, 1)
  const forks = path.filter((t) => t.is_fork).length

  return (
    <section className="flex min-h-0 flex-col panel" data-testid="token-view">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/5 px-5 py-3">
        <h2 className="panel-title">Completion</h2>
        <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-400">
          <Pill>{path.length} tokens</Pill>
          <Pill>depth {depth}</Pill>
          <Pill>H̄ {meanEntropy.toFixed(2)} bits</Pill>
          <Pill className="text-amber-300">{forks} fork points</Pill>
          <Pill>{active.method}</Pill>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Legend mode={colorMode} />
          <div className="flex rounded-lg border border-white/10 p-0.5 text-xs">
            {(['probability', 'entropy'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setColorMode(m)}
                className={clsx(
                  'rounded-md px-2.5 py-1 capitalize transition',
                  colorMode === m ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-3 flex gap-2 text-sm">
          <span className="mt-0.5 shrink-0 rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-violet-300 uppercase">
            user
          </span>
          <p className="text-slate-400 italic">{tree.prompt}</p>
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
          <span className="ml-1 rounded bg-white/5 px-1.5 py-0.5 align-middle text-[10px] text-slate-500">
            {active.finish_reason === 'length' ? '… max tokens' : '■ stop'}
          </span>
        )}
        {busy === 'branch' && (
          <div className="mt-3 animate-pulse text-xs text-violet-300">Generating branch…</div>
        )}
      </div>
    </section>
  )
}

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx('rounded-full border border-white/10 px-2 py-0.5', className)}>
      {children}
    </span>
  )
}

function Legend({ mode }: { mode: 'probability' | 'entropy' }) {
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => scaleColor(mode, t)).join(', ')
  return (
    <div className="hidden items-center gap-2 text-[10px] text-slate-500 xl:flex">
      <span>{mode === 'probability' ? 'unlikely' : 'certain'}</span>
      <span
        className="h-1.5 w-20 rounded-full"
        style={{ background: `linear-gradient(90deg, ${stops})` }}
      />
      <span>{mode === 'probability' ? 'likely' : 'uncertain'}</span>
    </div>
  )
}
