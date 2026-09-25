import type { ReactNode } from 'react'

import { pct } from '../lib/color'
import type { CompareSide, ProviderResult } from '../lib/types'
import { useStore } from '../store'
import { EntropyChart } from './EntropyChart'
import { ModelInput, Slider } from './ModelInput'
import { Spinner } from './PromptPanel'
import { TokenStrip } from './TokenStrip'

const COLORS = { a: '#2997ff', b: '#98989d' }

export function CompareView() {
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const a = useStore((s) => s.compareA)
  const b = useStore((s) => s.compareB)
  const setSide = useStore((s) => s.setCompareSide)
  const run = useStore((s) => s.runCompare)
  const busy = useStore((s) => s.busy)
  const result = useStore((s) => s.compareResult)
  const colorMode = useStore((s) => s.colorMode)
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)

  const m = result?.metrics
  const div = m?.first_divergence_index ?? null

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4" data-testid="compare-view">
      <section className="grid gap-4 panel p-4 lg:grid-cols-[minmax(0,1.4fr)_1fr_1fr_auto]">
        <label className="block">
          <span className="label">Prompt (shared)</span>
          <textarea
            className="min-h-[92px] input resize-y"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        <SideControls side="a" value={a} onChange={(p) => setSide('a', p)} />
        <SideControls side="b" value={b} onChange={(p) => setSide('b', p)} />
        <div className="flex w-44 flex-col justify-end gap-3">
          <Slider
            label="Max tokens"
            value={settings.max_tokens}
            min={8}
            max={200}
            step={4}
            onChange={(max_tokens) => update({ max_tokens })}
          />
          <button
            className="btn-primary py-2.5"
            disabled={busy !== null || !prompt.trim()}
            onClick={run}
          >
            {busy === 'compare' ? (
              <>
                <Spinner /> Running…
              </>
            ) : (
              'Compare'
            )}
          </button>
        </div>
      </section>

      {!result && (
        <section className="panel p-10 text-center text-sm text-slate-500">
          Run the same prompt under two temperatures or two models and see exactly where their
          futures split.
        </section>
      )}

      {result && m && (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Metric
              label="First divergence"
              value={div === null ? 'identical' : `token #${div}`}
              accent="text-rose-300"
            />
            <Metric label="Shared prefix" value={`${m.shared_prefix_tokens} tokens`} />
            <Metric label="Position agreement" value={pct(m.position_agreement, 0)} />
            <Metric
              label="Mean entropy A / B"
              value={
                <>
                  <span style={{ color: COLORS.a }}>{m.mean_entropy_a.toFixed(2)}</span>
                  <span className="text-slate-600"> / </span>
                  <span style={{ color: COLORS.b }}>{m.mean_entropy_b.toFixed(2)}</span>
                  <span className="text-xs text-slate-500"> bits</span>
                </>
              }
            />
            <Metric
              label="Mean |ΔH| (aligned)"
              value={`${m.mean_abs_entropy_delta.toFixed(2)} bits`}
            />
            <Metric
              label="Fork points A / B"
              value={`${m.fork_points_a} / ${m.fork_points_b}`}
              accent="text-amber-300"
            />
          </section>

          <section className="panel p-4">
            <h2 className="mb-2 panel-title">Per-token entropy</h2>
            <EntropyChart
              divergence={div}
              series={[
                { label: sideLabel('A', a), color: COLORS.a, tokens: result.a.tokens },
                { label: sideLabel('B', b), color: COLORS.b, tokens: result.b.tokens },
              ]}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <ResultColumn
              title={sideLabel('A', a)}
              color={COLORS.a}
              result={result.a}
              divergence={div}
              colorMode={colorMode}
            />
            <ResultColumn
              title={sideLabel('B', b)}
              color={COLORS.b}
              result={result.b}
              divergence={div}
              colorMode={colorMode}
            />
          </section>
        </>
      )}
    </div>
  )
}

const sideLabel = (name: string, s: CompareSide) =>
  `${name} · ${s.model} @ T=${s.temperature.toFixed(2)}`

function SideControls({
  side,
  value,
  onChange,
}: {
  side: 'a' | 'b'
  value: CompareSide
  onChange: (patch: Partial<CompareSide>) => void
}) {
  return (
    <div
      className="space-y-3 rounded-xl border border-white/5 bg-white/[0.02] p-3"
      style={{ borderColor: `${COLORS[side]}33` }}
    >
      <div
        className="text-xs font-semibold tracking-wider uppercase"
        style={{ color: COLORS[side] }}
      >
        Side {side.toUpperCase()}
      </div>
      <ModelInput value={value.model} onChange={(model) => onChange({ model })} />
      <Slider
        label="Temperature"
        value={value.temperature}
        min={0}
        max={2}
        step={0.05}
        onChange={(temperature) => onChange({ temperature })}
        format={(v) => v.toFixed(2)}
      />
    </div>
  )
}

function Metric({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[10px] tracking-widest text-slate-500 uppercase">{label}</div>
      <div className={`mt-1 font-mono text-lg text-slate-100 ${accent ?? ''}`}>{value}</div>
    </div>
  )
}

function ResultColumn({
  title,
  color,
  result,
  divergence,
  colorMode,
}: {
  title: string
  color: string
  result: ProviderResult
  divergence: number | null
  colorMode: 'probability' | 'entropy'
}) {
  return (
    <section className="panel p-4">
      <header className="mb-3 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <h3 className="text-sm font-medium text-slate-200">{title}</h3>
        <span className="ml-auto text-[11px] text-slate-500">
          {result.tokens.length} tokens · {result.finish_reason ?? '—'}
        </span>
      </header>
      <TokenStrip
        tokens={result.tokens.map((t, i) => ({ ...t, position: i }))}
        colorMode={colorMode}
        divergeFrom={divergence}
      />
    </section>
  )
}
