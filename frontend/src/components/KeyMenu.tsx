import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'

import { maskKey, type ByokProvider } from '../lib/byok'
import { useStore } from '../store'

/** Lets a visitor use their own OpenAI (or, where enabled, Gemini) key instead of the server's. */
export function KeyMenu() {
  const byok = useStore((s) => s.byok)
  const setByok = useStore((s) => s.setByok)
  const allowed = useStore((s) => s.config?.allow_byok ?? true)
  const configured = useStore((s) => s.config?.byok_providers)
  const providers: ByokProvider[] = configured?.length ? configured : ['openai', 'gemini']
  const [open, setOpen] = useState(false)
  const [picked, setProvider] = useState<ByokProvider | null>(byok?.provider ?? null)
  const provider: ByokProvider = picked && providers.includes(picked) ? picked : providers[0]
  const [key, setKey] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  if (!allowed) return null

  return (
    <div className="relative" ref={ref}>
      <button
        className={clsx('btn-ghost', byok && 'border-emerald-400/40 text-emerald-200')}
        onClick={() => setOpen((o) => !o)}
        data-testid="key-menu-button"
      >
        {byok ? `Your key · ${byok.provider}` : 'Use your key'}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-80 animate-fade-in rounded-xl border border-white/10 bg-ink-850/95 p-4 text-xs shadow-2xl backdrop-blur-xl">
          <h3 className="mb-1 text-sm font-semibold text-white">Use your own API key</h3>
          <p className="mb-3 leading-snug text-slate-400">
            Your key stays in this browser tab (sessionStorage) and is sent with each request over
            HTTPS. The server uses it for that request only and never stores or logs it. Requests
            with your own key skip the shared demo quota.
          </p>
          {byok ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-white/[0.04] px-3 py-2 font-mono text-slate-200">
                {byok.provider} · {maskKey(byok.key)}
              </div>
              <button
                className="btn-ghost w-full"
                onClick={() => {
                  setByok(null)
                  setKey('')
                }}
              >
                Remove key
              </button>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (!key.trim()) return
                setByok({ provider, key })
                setKey('')
                setOpen(false)
              }}
            >
              {providers.length > 1 && (
                <div className="flex rounded-lg border border-white/10 p-0.5">
                  {providers.map((p) => (
                    <button
                      type="button"
                      key={p}
                      onClick={() => setProvider(p)}
                      className={clsx(
                        'flex-1 rounded-md px-2 py-1 capitalize transition',
                        provider === p ? 'bg-white/10 text-white' : 'text-slate-400',
                      )}
                    >
                      {p === 'openai' ? 'OpenAI' : 'Gemini'}
                    </button>
                  ))}
                </div>
              )}
              {provider === 'gemini' ? (
                <p className="leading-snug text-amber-200/80" data-testid="gemini-note">
                  Gemini only returns logprobs on 2.x models, which new keys can no longer use.
                  Newer Gemini models reject logprobs, so most keys won&apos;t work here.
                </p>
              ) : (
                <p className="leading-snug text-slate-500">
                  OpenAI chat models such as gpt-4o-mini return logprobs. Reasoning models
                  don&apos;t.
                </p>
              )}
              <input
                className="input font-mono text-xs"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={provider === 'openai' ? 'sk-…' : 'AI Studio key'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                aria-label="API key"
              />
              <button className="btn-primary w-full" disabled={!key.trim()}>
                Use this key
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
