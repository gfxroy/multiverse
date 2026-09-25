import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, setRemainingListener } from './api'
import { byokHeaders, getByok, maskKey, setByok } from './byok'

afterEach(() => {
  setByok(null)
  vi.unstubAllGlobals()
})

describe('own-key handling', () => {
  it('keeps the key in sessionStorage only and builds headers', () => {
    expect(byokHeaders()).toEqual({})
    setByok({ provider: 'gemini', key: '  placeholder  ' })
    expect(getByok()).toEqual({ provider: 'gemini', key: 'placeholder' })
    expect(sessionStorage.getItem('multiverse.byok')).toContain('gemini')
    expect(localStorage.length).toBe(0)
    expect(byokHeaders()).toEqual({
      'X-Multiverse-Provider': 'gemini',
      'X-Multiverse-Key': 'placeholder',
    })
    setByok(null)
    expect(sessionStorage.getItem('multiverse.byok')).toBeNull()
  })

  it('masks keys for display', () => {
    expect(maskKey('sk-1234567890abcd')).toBe('sk-…abcd')
    expect(maskKey('short')).toBe('••••')
  })

  it('sends the key with API requests and reports remaining quota', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'X-RateLimit-Remaining': '7' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const seen: number[] = []
    setRemainingListener((n) => seen.push(n))
    setByok({ provider: 'openai', key: 'sk-visitor' })
    await api.config()
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>)['X-Multiverse-Key']).toBe('sk-visitor')
    expect(seen).toEqual([7])
    setRemainingListener(null)
  })

  it('surfaces friendly 429 messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "You've hit the rate limit" }), { status: 429 }),
      ),
    )
    await expect(api.config()).rejects.toMatchObject({
      status: 429,
      message: "You've hit the rate limit",
    })
  })
})
