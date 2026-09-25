import clsx from 'clsx'
import { useRef } from 'react'

import { STATIC } from '../lib/api'
import { downloadJson, permalink, readTreeFile } from '../lib/share'
import { useStore, type Tab } from '../store'
import { KeyMenu } from './KeyMenu'

export function Header() {
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const tree = useStore((s) => s.tree)
  const config = useStore((s) => s.config)
  const loadTree = useStore((s) => s.loadTree)
  const showToast = useStore((s) => s.showToast)
  const byok = useStore((s) => s.byok)
  const remaining = useStore((s) => s.remaining)
  const fileRef = useRef<HTMLInputElement>(null)

  const share = async () => {
    if (!tree) return
    const url = permalink(tree)
    window.history.replaceState(null, '', url)
    try {
      await navigator.clipboard.writeText(url)
      showToast(`Permalink copied (${(url.length / 1024).toFixed(1)} KB URL)`)
    } catch {
      showToast('Permalink is in the address bar')
    }
  }

  return (
    <header className="flex items-center gap-4 border-b border-white/[0.08] bg-[#000000]/80 px-6 py-3 backdrop-blur-2xl">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05]">
          <span className="text-xs font-semibold text-white">M</span>
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-white">
            Multiverse
          </h1>
          <p className="text-[11px] text-neutral-400">Token-level branch explorer</p>
        </div>
      </div>

      <nav className="ml-6 flex rounded-xl border border-white/10 bg-white/[0.04] p-0.5 text-xs font-medium">
        {(['explore', 'compare'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'rounded-lg px-3.5 py-1.5 capitalize transition-all duration-150',
              tab === t
                ? 'bg-white/15 text-white shadow-sm'
                : 'text-neutral-400 hover:text-white',
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {remaining !== null && !byok && (
          <span
            className={clsx(
              'text-[11px] tabular-nums',
              remaining <= 2 ? 'text-rose-300' : 'text-neutral-400',
            )}
            title="Model calls left for you in the current rate-limit window"
            data-testid="quota"
          >
            {remaining} calls left
          </span>
        )}
        {config && (
          <span
            className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-neutral-300 font-normal"
            data-testid="provider-badge"
          >
            {byok
              ? `Live · ${byok.provider}`
              : config.demo_mode
                ? 'Demo · mock model'
                : `Live · ${config.provider}`}
          </span>
        )}
        <KeyMenu />
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            try {
              loadTree(await readTreeFile(file), `Imported ${file.name}`)
            } catch (err) {
              showToast(`Import failed: ${err instanceof Error ? err.message : err}`)
            }
          }}
        />
        <button className="btn-ghost text-xs" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <button className="btn-ghost text-xs" disabled={!tree} onClick={() => tree && downloadJson(tree)}>
          Export
        </button>
        <button className="btn-ghost text-xs" disabled={!tree} onClick={share}>
          Share
        </button>
        <a
          className="btn-ghost text-xs"
          href="https://github.com/gfxroy/multiverse"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </div>
    </header>
  )
}

export function DemoBanner() {
  const config = useStore((s) => s.config)
  const configError = useStore((s) => s.configError)
  const byok = useStore((s) => s.byok)
  if (configError) {
    return (
      <div className="border-b border-rose-500/20 bg-rose-500/10 px-6 py-2 text-xs text-rose-200">
        {configError}. Start the backend with <code className="font-mono">make dev</code> or{' '}
        <code className="font-mono">docker compose up</code>.
      </div>
    )
  }
  if (!config?.demo_mode || byok) return null
  return (
    <div
      className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-6 py-2 text-xs text-neutral-400"
      data-testid="demo-banner"
    >
      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-neutral-300">
        DEMO
      </span>
      <span>
        Tokens and probabilities come from a deterministic mock model. Click “Use
        your key” to run a real model with your own OpenAI key
        {STATIC ? (
          ' (runs locally in your browser).'
        ) : (
          <>
            {' '}
            (or set{' '}
            <code className="rounded bg-white/10 px-1 font-mono text-[11px]">OPENAI_API_KEY</code> in{' '}
            <code className="rounded bg-white/10 px-1 font-mono text-[11px]">.env</code>).
          </>
        )}
      </span>
    </div>
  )
}

export function Toasts() {
  const toast = useStore((s) => s.toast)
  const error = useStore((s) => s.error)
  const clearError = useStore((s) => s.clearError)
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-50 flex flex-col items-end gap-2">
      {error && (
        <div className="pointer-events-auto flex max-w-md animate-fade-in items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-950/90 px-4 py-3 text-sm text-rose-100 shadow-2xl">
          <span className="flex-1">{error}</span>
          <button
            onClick={clearError}
            className="text-rose-300 hover:text-white"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      {toast && (
        <div className="animate-fade-in rounded-xl border border-white/10 bg-ink-800/95 px-4 py-2.5 text-sm text-slate-200 shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  )
}
