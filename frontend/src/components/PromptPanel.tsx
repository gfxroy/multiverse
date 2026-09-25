import { useStore } from '../store'
import { ModelInput, Slider } from './ModelInput'

const EXAMPLES = [
  'Write a short story about a lighthouse keeper.',
  'Explain how a language model picks the next token.',
  'Describe a city at night in the future.',
  'Who was the first person to walk on Mars?',
]

export function PromptPanel() {
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const generate = useStore((s) => s.generate)
  const busy = useStore((s) => s.busy)
  const limit = useStore((s) => s.config?.max_tokens_limit ?? 512)

  return (
    <section className="flex flex-col gap-4 panel p-4">
      <h2 className="panel-title">Prompt</h2>
      <textarea
        className="min-h-[110px] input resize-y leading-relaxed"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) generate()
        }}
        placeholder="Ask anything…"
        aria-label="Prompt"
      />
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-400 transition hover:border-violet-400/50 hover:text-slate-200"
            onClick={() => setPrompt(ex)}
          >
            {ex.length > 28 ? `${ex.slice(0, 28)}…` : ex}
          </button>
        ))}
      </div>
      <ModelInput value={settings.model} onChange={(model) => update({ model })} />
      <Slider
        label="Temperature"
        value={settings.temperature}
        min={0}
        max={2}
        step={0.05}
        onChange={(temperature) => update({ temperature })}
        format={(v) => v.toFixed(2)}
      />
      <Slider
        label="Max tokens"
        value={settings.max_tokens}
        min={8}
        max={Math.min(limit, 400)}
        step={4}
        onChange={(max_tokens) => update({ max_tokens })}
      />
      <Slider
        label="Top alternatives (top_logprobs)"
        value={settings.top_logprobs}
        min={1}
        max={20}
        step={1}
        onChange={(top_logprobs) => update({ top_logprobs })}
      />
      <button
        className="btn-primary py-2.5"
        onClick={() => generate()}
        disabled={busy !== null || !prompt.trim()}
      >
        {busy === 'generate' ? (
          <>
            <Spinner /> Generating…
          </>
        ) : (
          <>Generate ✦</>
        )}
      </button>
      <p className="-mt-2 text-center text-[10px] text-slate-600">Ctrl/⌘ + Enter</p>
    </section>
  )
}

export function Spinner() {
  return (
    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
  )
}
