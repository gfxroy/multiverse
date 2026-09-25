// Mirrors backend/app/schemas.py. Keep the two in sync.

export interface Alternative {
  token: string
  logprob: number
  prob: number
}

export interface TokenInfo {
  token: string
  logprob: number | null
  prob: number | null
  entropy: number
  margin: number
  top: Alternative[]
  is_fork: boolean
  fork_score: number
  forced: boolean
}

export interface GenerationSettings {
  model: string
  temperature: number
  max_tokens: number
  top_logprobs: number
  system_prompt?: string | null
}

export interface ForkSettings {
  entropy_threshold: number
  margin_threshold: number
  min_alt_prob: number
}

export type GenerationMethod = 'chat' | 'chat-continuation' | 'mock'

export interface TreeNode {
  id: string
  parent_id: string | null
  fork_index: number
  tokens: TokenInfo[]
  children: string[]
  model: string
  temperature: number
  method: GenerationMethod
  finish_reason: string | null
  label?: string | null
}

export interface Tree {
  version: 1
  prompt: string
  settings: GenerationSettings
  fork_settings: ForkSettings
  root_id: string
  nodes: Record<string, TreeNode>
  provider: string
}

export interface ProviderResult {
  tokens: TokenInfo[]
  finish_reason: string | null
  model: string
  method: GenerationMethod
}

export interface DivergenceMetrics {
  first_divergence_index: number | null
  shared_prefix_tokens: number
  position_agreement: number
  mean_entropy_a: number
  mean_entropy_b: number
  mean_abs_entropy_delta: number
  fork_points_a: number
  fork_points_b: number
}

export interface CompareSide {
  model: string
  temperature: number
}

export interface CompareResponse {
  a: ProviderResult
  b: ProviderResult
  metrics: DivergenceMetrics
}

export interface ModelsInfo {
  provider: string
  demo_mode: boolean
  default_model: string
  models: string[]
  max_tokens_limit: number
  version: string
}
