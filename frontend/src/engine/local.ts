// In-browser replacement for the FastAPI backend, used by the static GitHub Pages build.
// Same request/response shapes as src/lib/api.ts, so the UI doesn't know the difference.
// Demo mode uses the mock model; with an own OpenAI key the browser calls OpenAI directly.
import { getByok } from '../lib/byok'
import type {
  CompareResponse,
  CompareSide,
  ForkSettings,
  GenerationSettings,
  ModelsInfo,
  Tree,
} from '../lib/types'
import { divergenceMetrics } from './compare'
import { MockProvider } from './mock'
import { OpenAIBrowserProvider, ProviderError } from './openai'
import {
  attachBranch,
  createTree,
  explore,
  markForks,
  planBranch,
  TreeError,
  type Provider,
} from './tree'

export const OPENAI_MODELS = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o']
// Like the server's demo mode: model names only change the mock model's "personality".
export const MOCK_MODELS = OPENAI_MODELS

/** Client-side caps (own-key calls cost the visitor money; keep them modest). */
export const LIMITS = {
  maxTokens: 200,
  maxTopLogprobs: 20,
  maxExploreNodesDemo: 24,
  maxExploreNodesOwnKey: 10,
  maxPromptChars: 4000,
  maxTreeNodes: 200,
  concurrency: 3,
}

/** Error with an HTTP-like status, like ApiError from the server client. */
export class LocalError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

let mock: Provider = new MockProvider(120)

/** For tests: replace the demo provider (e.g. with a zero-latency one). */
export function setMockProvider(p: Provider): void {
  mock = p
}

function provider(): Provider {
  const byok = getByok()
  if (byok?.provider === 'openai') return new OpenAIBrowserProvider(byok.key)
  return mock
}

const ownKey = () => getByok()?.provider === 'openai'

function clamp(s: GenerationSettings): GenerationSettings {
  return {
    ...s,
    max_tokens: Math.max(1, Math.min(s.max_tokens, LIMITS.maxTokens)),
    top_logprobs: Math.max(1, Math.min(s.top_logprobs, LIMITS.maxTopLogprobs)),
  }
}

function checkPrompt(prompt: string): void {
  if (!prompt.trim()) throw new LocalError('Prompt is empty', 422)
  if (prompt.length > LIMITS.maxPromptChars) {
    throw new LocalError(`Prompt is too long (max ${LIMITS.maxPromptChars} characters)`, 422)
  }
}

/** Copy, validate and re-mark a tree from the UI (thresholds may have changed). */
function prepare(tree: Tree): Tree {
  checkPrompt(tree.prompt)
  if (Object.keys(tree.nodes).length > LIMITS.maxTreeNodes) {
    throw new LocalError(`Tree is too large (max ${LIMITS.maxTreeNodes} branches)`, 422)
  }
  const copy = structuredClone(tree)
  copy.settings = clamp(copy.settings)
  for (const node of Object.values(copy.nodes)) markForks(node.tokens, copy.fork_settings)
  return copy
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ProviderError) throw new LocalError(e.message, e.status)
    if (e instanceof TreeError) throw new LocalError(e.message, 422)
    throw e
  }
}

export const localApi = {
  config: async (): Promise<ModelsInfo> => {
    const own = ownKey()
    return {
      provider: own ? 'openai' : 'mock',
      demo_mode: !own,
      default_model: own ? OPENAI_MODELS[0] : MOCK_MODELS[0],
      models: own ? OPENAI_MODELS : MOCK_MODELS,
      provider_models: { openai: OPENAI_MODELS },
      allow_byok: true,
      byok_providers: ['openai'],
      max_tokens_limit: LIMITS.maxTokens,
      limits: {
        rate_limit_calls: 0,
        rate_limit_window_seconds: 0,
        daily_call_cap: 0,
        max_top_logprobs: LIMITS.maxTopLogprobs,
        max_explore_nodes: own ? LIMITS.maxExploreNodesOwnKey : LIMITS.maxExploreNodesDemo,
        max_prompt_chars: LIMITS.maxPromptChars,
        remaining: null,
      },
      version: 'static',
    }
  },

  generate: (prompt: string, settings: GenerationSettings, fork_settings: ForkSettings) =>
    run(async (): Promise<Tree> => {
      checkPrompt(prompt)
      const s = clamp(settings)
      const p = provider()
      const result = await p.complete(prompt, s)
      return createTree(prompt, s, fork_settings, result, p.name)
    }),

  branch: (tree: Tree, node_id: string, position: number, token: string) =>
    run(async () => {
      const t = prepare(tree)
      const plan = planBranch(t, node_id, position, token)
      if (typeof plan === 'string') return { tree: t, node_id: plan, created: false }
      const result = await provider().complete(t.prompt, t.settings, plan.prefix)
      return { tree: t, node_id: attachBranch(t, plan, result), created: true }
    }),

  explore: (tree: Tree, node_id: string, top_k: number, depth: number) =>
    run(async () => {
      const t = prepare(tree)
      const [created, truncated] = await explore(t, node_id, provider(), {
        topK: Math.min(Math.max(top_k, 1), 5),
        depth: Math.min(Math.max(depth, 1), 3),
        maxNodes: ownKey() ? LIMITS.maxExploreNodesOwnKey : LIMITS.maxExploreNodesDemo,
        concurrency: LIMITS.concurrency,
      })
      return { tree: t, created, truncated, rate_limited: false }
    }),

  compare: (
    prompt: string,
    a: CompareSide,
    b: CompareSide,
    max_tokens: number,
    top_logprobs: number,
    fork_settings: ForkSettings,
  ) =>
    run(async (): Promise<CompareResponse> => {
      checkPrompt(prompt)
      const side = (c: CompareSide) =>
        clamp({ model: c.model, temperature: c.temperature, max_tokens, top_logprobs })
      const p = provider()
      const [ra, rb] = await Promise.all([p.complete(prompt, side(a)), p.complete(prompt, side(b))])
      markForks(ra.tokens, fork_settings)
      markForks(rb.tokens, fork_settings)
      return { a: ra, b: rb, metrics: divergenceMetrics(ra.tokens, rb.tokens) }
    }),
}
