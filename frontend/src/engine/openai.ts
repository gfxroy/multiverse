// Browser port of backend/app/providers/openai_provider.py for the static (GitHub Pages)
// build. Requests go straight from the browser to OpenAI with the visitor's own key; no
// other server ever sees the key.
import type { GenerationSettings, ProviderResult, TokenInfo } from '../lib/types'
import { annotateToken, buildAlternatives } from './entropy'
import type { Provider } from './tree'

export const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

export const CONTINUE_INSTRUCTION =
  'Continue your previous message exactly where it stopped, as if you had never been ' +
  'interrupted. It may stop mid-sentence or mid-word. Output only the continuation text: ' +
  'do not repeat any of it, do not restart, and do not comment. If the next word needs a ' +
  'leading space, include it.'

export class ProviderError extends Error {
  readonly status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

type Message = { role: 'system' | 'user' | 'assistant'; content: string }

/** Chat messages for a root generation (no prefix) or a branch continuation. */
export function buildMessages(
  prompt: string,
  prefix = '',
  systemPrompt?: string | null,
): Message[] {
  const messages: Message[] = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: prompt })
  if (prefix) {
    messages.push({ role: 'assistant', content: prefix })
    messages.push({ role: 'user', content: CONTINUE_INSTRUCTION })
  }
  return messages
}

interface LogprobItem {
  token: string
  logprob: number
  top_logprobs?: { token: string; logprob: number }[] | null
}

export function parseLogprobs(content: LogprobItem[] | null | undefined): TokenInfo[] {
  return (content ?? []).map((item) =>
    annotateToken(
      item.token,
      item.logprob,
      buildAlternatives((item.top_logprobs ?? []).map((a) => [a.token, a.logprob])),
    ),
  )
}

export class OpenAIBrowserProvider implements Provider {
  readonly name = 'openai'
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch
  private readonly url: string
  constructor(
    apiKey: string,
    fetchImpl: typeof fetch = (...args) => fetch(...args),
    url = OPENAI_URL,
  ) {
    this.apiKey = apiKey
    this.fetchImpl = fetchImpl
    this.url = url
  }

  async complete(
    prompt: string,
    settings: GenerationSettings,
    prefix = '',
  ): Promise<ProviderResult> {
    let res: Response
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: settings.model,
          messages: buildMessages(prompt, prefix, settings.system_prompt),
          temperature: settings.temperature,
          max_completion_tokens: settings.max_tokens,
          logprobs: true,
          top_logprobs: settings.top_logprobs,
        }),
      })
    } catch (e) {
      throw new ProviderError(`Could not reach OpenAI: ${e instanceof Error ? e.message : e}`)
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const message: string = data?.error?.message ?? res.statusText
      if (res.status === 401) throw new ProviderError('OpenAI rejected the API key (401).', 401)
      if (res.status === 429) {
        throw new ProviderError(`OpenAI rate limit or quota exceeded: ${message}`, 429)
      }
      const hint =
        res.status === 400 && message.toLowerCase().includes('logprobs')
          ? ' This model does not seem to support logprobs.'
          : ''
      throw new ProviderError(`OpenAI error ${res.status}: ${message}${hint}`, res.status)
    }
    const choice = data?.choices?.[0]
    if (!choice) throw new ProviderError('OpenAI returned no choices')
    if (!choice.logprobs?.content) {
      throw new ProviderError(
        `Model ${JSON.stringify(settings.model)} returned no logprobs; pick a model that supports them.`,
      )
    }
    return {
      tokens: parseLogprobs(choice.logprobs.content),
      finish_reason: choice.finish_reason ?? null,
      model: data.model ?? settings.model,
      method: prefix ? 'chat-continuation' : 'chat',
    }
  }
}
