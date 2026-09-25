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
    <header className="flex items-center gap-4 border-b border-white/5 bg-ink-950/60 px-5 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
        <div>
          <h1 className="bg-gradient-to-r from-violet-300 via-fuchsia-200 to-cyan-300 bg-clip-text text-lg leading-none font-bold tracking-tight text-transparent">
            Multiverse
          </h1>
          <p className="mt-0.5 text-[11px] text-slate-500">what the model almost said</p>
        </div>
      </div>

      <nav className="ml-6 flex rounded-xl border border-white/10 bg-white/[0.03] p-1 text-sm">
        {(['explore', 'compare'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'rounded-lg px-4 py-1.5 capitalize transition',
              tab === t
                ? 'bg-gradient-to-r from-violet-500/30 to-cyan-500/20 text-white shadow-inner'
                : 'text-slate-400 hover:text-white',
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
              remaining <= 2 ? 'text-rose-300' : 'text-slate-500',
            )}
            title="Model calls left for you in the current rate-limit window"
            data-testid="quota"
          >
            {remaining} calls left
          </span>
        )}
        {config && (
          <span
            className={clsx(
              'rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide',
              byok
                ? 'bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30'
                : config.demo_mode
                  ? 'bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/40'
                  : 'bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30',
            )}
            data-testid="provider-badge"
          >
            {byok
              ? `LIVE · ${byok.provider} (your key)`
              : config.demo_mode
                ? 'DEMO · mock model'
                : `LIVE · ${config.provider}`}
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
        <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <button className="btn-ghost" disabled={!tree} onClick={() => tree && downloadJson(tree)}>
          Export JSON
        </button>
        <button className="btn-ghost" disabled={!tree} onClick={share}>
          Share link
        </button>
        <a
          className="btn-ghost"
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
      <div className="border-b border-rose-500/30 bg-rose-500/10 px-5 py-2 text-xs text-rose-200">
        {configError}. Start the backend with <code className="font-mono">make dev</code> or{' '}
        <code className="font-mono">docker compose up</code>.
      </div>
    )
  }
  if (!config?.demo_mode || byok) return null
  return (
    <div
      className="flex items-center gap-2 border-b border-amber-400/20 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent px-5 py-2 text-xs text-amber-200"
      data-testid="demo-banner"
    >
      <span className="rounded bg-amber-400/20 px-1.5 py-0.5 font-bold tracking-wider">
        DEMO MODE
      </span>
      <span>
        Tokens and probabilities come from a deterministic mock model, not a real LLM. Click “Use
        your key” to run a real model with your own OpenAI key
        {STATIC ? (
          ' (the whole app runs in your browser).'
        ) : (
          <>
            {' '}
            (self-hosting: set{' '}
            <code className="rounded bg-black/30 px-1 font-mono">OPENAI_API_KEY</code> in{' '}
            <code className="rounded bg-black/30 px-1 font-mono">.env</code>).
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
