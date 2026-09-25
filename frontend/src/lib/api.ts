import type {
  CompareResponse,
  CompareSide,
  ForkSettings,
  GenerationSettings,
  ModelsInfo,
  Tree,
} from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status)
  }
  return (await res.json()) as T
}

export const api = {
  config: () => request<ModelsInfo>('/api/config'),
  generate: (prompt: string, settings: GenerationSettings, fork_settings: ForkSettings) =>
    request<Tree>('/api/generate', { prompt, settings, fork_settings }),
  branch: (tree: Tree, node_id: string, position: number, token: string) =>
    request<{ tree: Tree; node_id: string; created: boolean }>('/api/branch', {
      tree,
      node_id,
      position,
      token,
    }),
  explore: (tree: Tree, node_id: string, top_k: number, depth: number) =>
    request<{ tree: Tree; created: string[]; truncated: boolean }>('/api/explore', {
      tree,
      node_id,
      top_k,
      depth,
    }),
  compare: (
    prompt: string,
    a: CompareSide,
    b: CompareSide,
    max_tokens: number,
    top_logprobs: number,
    fork_settings: ForkSettings,
  ) =>
    request<CompareResponse>('/api/compare', {
      prompt,
      a,
      b,
      max_tokens,
      top_logprobs,
      fork_settings,
    }),
}
