import { describe, expect, it, vi } from 'vitest'

import { buildMessages, CONTINUE_INSTRUCTION, OPENAI_URL, OpenAIBrowserProvider } from './openai'
import { settings } from './testing'

const item = (token: string, logprob: number, top: [string, number][]) => ({
  token,
  logprob,
  top_logprobs: top.map(([t, l]) => ({ token: t, logprob: l })),
})

function fakeFetch(status: number, body: unknown) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  )
}

describe('OpenAI browser provider (mirrors backend/tests/test_openai_provider.py)', () => {
  it('builds root and continuation messages', () => {
    expect(buildMessages('hi')).toEqual([{ role: 'user', content: 'hi' }])
    expect(buildMessages('hi', '', 'be terse')[0]).toEqual({ role: 'system', content: 'be terse' })
    const msgs = buildMessages('hi', 'Hello the')
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'Hello the' })
    expect(msgs[2]).toEqual({ role: 'user', content: CONTINUE_INSTRUCTION })
  })

  it('sends the key only to OpenAI, with logprobs parameters, and parses the reply', async () => {
    const fetchMock = fakeFetch(200, {
      model: 'gpt-4o-mini-2024-07-18',
      choices: [
        {
          finish_reason: 'stop',
          logprobs: {
            content: [
              item('Hello', -0.1, [
                ['Hello', -0.1],
                ['Hi', -2.5],
              ]),
              item(' world', -0.7, [
                [' world', -0.7],
                [' there', -0.9],
              ]),
            ],
          },
        },
      ],
    })
    const p = new OpenAIBrowserProvider('sk-test', fetchMock)
    const r = await p.complete(
      'Say hi',
      settings({ temperature: 0.3, max_tokens: 12, top_logprobs: 5 }),
      'Hello the',
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(OPENAI_URL)
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init!.body as string)
    expect(body).toMatchObject({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_completion_tokens: 12,
      logprobs: true,
      top_logprobs: 5,
    })
    expect(body.messages.at(-1).content).toBe(CONTINUE_INSTRUCTION)
    expect(r.method).toBe('chat-continuation')
    expect(r.model).toBe('gpt-4o-mini-2024-07-18')
    expect(r.tokens.map((t) => t.token)).toEqual(['Hello', ' world'])
    expect(r.tokens[1].top[1]).toMatchObject({ token: ' there' })
    expect(r.tokens[1].entropy).toBeGreaterThan(0)
  })

  it('explains missing logprobs, bad keys and rate limits', async () => {
    const noLogprobs = fakeFetch(200, { choices: [{ finish_reason: 'stop', logprobs: null }] })
    await expect(
      new OpenAIBrowserProvider('k', noLogprobs).complete('x', settings()),
    ).rejects.toThrow(/returned no logprobs/)
    await expect(
      new OpenAIBrowserProvider('k', fakeFetch(401, { error: { message: 'bad' } })).complete(
        'x',
        settings(),
      ),
    ).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/rejected the API key/) })
    await expect(
      new OpenAIBrowserProvider('k', fakeFetch(429, { error: { message: 'slow down' } })).complete(
        'x',
        settings(),
      ),
    ).rejects.toMatchObject({ status: 429 })
    await expect(
      new OpenAIBrowserProvider(
        'k',
        fakeFetch(400, { error: { message: 'logprobs are not supported with this model' } }),
      ).complete('x', settings({ model: 'o3' })),
    ).rejects.toThrow(/does not seem to support logprobs/)
  })
})
