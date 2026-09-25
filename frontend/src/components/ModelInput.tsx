import { useId } from 'react'

import { useStore } from '../store'

const NO_MODELS: string[] = []

/** Model picker that also accepts any typed model name. */
export function ModelInput({
  value,
  onChange,
  label = 'Model',
}: {
  value: string
  onChange: (model: string) => void
  label?: string
}) {
  const models = useStore((s) => s.config?.models ?? NO_MODELS)
  const listId = useId()
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        className="input font-mono"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      <datalist id={listId}>
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </label>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v: number) => String(v),
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        <span className="font-mono text-slate-200">{format(value)}</span>
      </span>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
