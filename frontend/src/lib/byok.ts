// "Bring your own key": kept only in this browser tab (sessionStorage) and sent as a header
// with each API request. The server uses it for that request only and never stores it.

export type ByokProvider = 'openai' | 'gemini'

export interface Byok {
  provider: ByokProvider
  key: string
}

const STORAGE_KEY = 'multiverse.byok'
let current: Byok | null = load()

function load(): Byok | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Byok) : null
    return parsed && parsed.key && (parsed.provider === 'openai' || parsed.provider === 'gemini')
      ? parsed
      : null
  } catch {
    return null
  }
}

export function getByok(): Byok | null {
  return current
}

export function setByok(value: Byok | null): void {
  current = value && value.key.trim() ? { ...value, key: value.key.trim() } : null
  try {
    if (current) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage unavailable: keep it in memory only */
  }
}

export function byokHeaders(): Record<string, string> {
  return current
    ? { 'X-Multiverse-Provider': current.provider, 'X-Multiverse-Key': current.key }
    : {}
}

export function maskKey(key: string): string {
  return key.length <= 8 ? '••••' : `${key.slice(0, 3)}…${key.slice(-4)}`
}
