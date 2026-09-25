// Port of backend/app/tree.py: branching and breadth-first auto-exploration.
// Invariant: fullPath(node) = fullPath(parent).slice(0, node.fork_index) + node.tokens.
// These functions mutate the tree they are given; callers pass a copy.
import { forkScore, isFork } from '../lib/forks'
import { lineage } from '../lib/tree'
import type {
  ForkSettings,
  GenerationSettings,
  ProviderResult,
  TokenInfo,
  Tree,
  TreeNode,
} from '../lib/types'
import { annotateToken } from './entropy'

export class TreeError extends Error {}

export interface Provider {
  name: string
  complete(prompt: string, settings: GenerationSettings, prefix?: string): Promise<ProviderResult>
}

export function newId(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const tokensText = (tokens: TokenInfo[]) => tokens.map((t) => t.token).join('')

export function getNode(tree: Tree, nodeId: string): TreeNode {
  const node = tree.nodes[nodeId]
  if (!node) throw new TreeError(`Unknown node ${JSON.stringify(nodeId)}`)
  return node
}

/** All tokens from the start of the reply to the end of `nodeId` (plain TokenInfo). */
export function fullTokens(tree: Tree, nodeId: string): TokenInfo[] {
  getNode(tree, nodeId)
  let path: TokenInfo[] = []
  for (const node of lineage(tree, nodeId))
    path = [...path.slice(0, node.fork_index), ...node.tokens]
  return path
}

export function markForks(tokens: TokenInfo[], settings: ForkSettings): TokenInfo[] {
  for (const t of tokens) {
    t.fork_score = Math.round(forkScore(t) * 1e6) / 1e6
    t.is_fork = isFork(t, settings)
  }
  return tokens
}

/** Indices of fork tokens at or after `start`, most uncertain first. */
export function rankForks(tokens: TokenInfo[], start = 0): number[] {
  const idx: number[] = []
  for (let i = start; i < tokens.length; i++) if (tokens[i].is_fork) idx.push(i)
  return idx.sort((a, b) => tokens[b].fork_score - tokens[a].fork_score || a - b)
}

/** The node on `nodeId`'s lineage that generated the token at `position`. */
export function ownerOf(tree: Tree, nodeId: string, position: number): string {
  let node = getNode(tree, nodeId)
  while (node.parent_id !== null && position < node.fork_index) node = getNode(tree, node.parent_id)
  return node.id
}

export function findChild(
  tree: Tree,
  parentId: string,
  forkIndex: number,
  token: string,
): string | null {
  for (const id of getNode(tree, parentId).children) {
    const child = tree.nodes[id]
    if (child.fork_index === forkIndex && child.tokens[0]?.token === token) return id
  }
  return null
}

/** A token forced at a position whose distribution is `original.top`. */
export function forcedToken(original: TokenInfo, token: string): TokenInfo {
  const match = original.top.find((a) => a.token === token)
  return annotateToken(
    token,
    match ? match.logprob : null,
    original.top.map((a) => ({ ...a })),
    true,
  )
}

export function createTree(
  prompt: string,
  settings: GenerationSettings,
  forkSettings: ForkSettings,
  result: ProviderResult,
  provider: string,
): Tree {
  const root: TreeNode = {
    id: newId(),
    parent_id: null,
    fork_index: 0,
    tokens: markForks(result.tokens, forkSettings),
    children: [],
    model: result.model,
    temperature: settings.temperature,
    method: result.method,
    finish_reason: result.finish_reason,
    label: 'root',
  }
  return {
    version: 1,
    prompt,
    settings,
    fork_settings: forkSettings,
    root_id: root.id,
    nodes: { [root.id]: root },
    provider,
  }
}

export interface BranchPlan {
  parentId: string
  position: number
  token: string
  prefix: string
  forced: TokenInfo
}

/** Resolve a branch request; returns an existing node id if nothing needs generating. */
export function planBranch(
  tree: Tree,
  nodeId: string,
  position: number,
  token: string,
): BranchPlan | string {
  const path = fullTokens(tree, nodeId)
  if (position < 0 || position >= path.length) {
    throw new TreeError(`Position ${position} is out of range (path has ${path.length} tokens)`)
  }
  const parentId = ownerOf(tree, nodeId, position)
  const original = path[position]
  if (original.token === token) return nodeId
  const existing = findChild(tree, parentId, position, token)
  if (existing !== null) return existing
  const prefix = tokensText(path.slice(0, position)) + token
  return { parentId, position, token, prefix, forced: forcedToken(original, token) }
}

export function attachBranch(tree: Tree, plan: BranchPlan, result: ProviderResult): string {
  const existing = findChild(tree, plan.parentId, plan.position, plan.token)
  if (existing !== null) return existing
  const parent = getNode(tree, plan.parentId)
  const node: TreeNode = {
    id: newId(),
    parent_id: parent.id,
    fork_index: plan.position,
    tokens: markForks([plan.forced, ...result.tokens], tree.fork_settings),
    children: [],
    model: result.model,
    temperature: tree.settings.temperature,
    method: result.method,
    finish_reason: result.finish_reason,
  }
  tree.nodes[node.id] = node
  parent.children.push(node.id)
  return node.id
}

/** Force `token` at `position` of `nodeId`'s path. Returns [nodeId, created]. */
export async function branch(
  tree: Tree,
  nodeId: string,
  position: number,
  token: string,
  provider: Provider,
): Promise<[string, boolean]> {
  const plan = planBranch(tree, nodeId, position, token)
  if (typeof plan === 'string') return [plan, false]
  const result = await provider.complete(tree.prompt, tree.settings, plan.prefix)
  return [attachBranch(tree, plan, result), true]
}

/** Plans forking `nodeId` at its `topK` most uncertain positions (best unexplored alternative). */
export function explorePlans(tree: Tree, nodeId: string, topK: number): BranchPlan[] {
  const node = getNode(tree, nodeId)
  const start = node.parent_id !== null ? 1 : 0 // skip this node's own forced token
  const plans: BranchPlan[] = []
  for (const local of rankForks(node.tokens, start)) {
    if (plans.length >= topK) break
    const position = node.fork_index + local
    const chosen = node.tokens[local]
    for (const alt of chosen.top) {
      if (alt.token === chosen.token || !alt.token) continue
      const plan = planBranch(tree, nodeId, position, alt.token)
      if (typeof plan !== 'string') {
        plans.push(plan)
        break
      }
    }
  }
  return plans
}

/** Run async jobs with at most `limit` in flight, keeping result order. */
export async function pool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(jobs.length)
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++
      results[i] = await jobs[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker))
  return results
}

export interface ExploreOptions {
  topK?: number
  depth?: number
  maxNodes?: number
  concurrency?: number
}

/** Breadth-first auto-exploration. Returns [createdIds, truncated]. */
export async function explore(
  tree: Tree,
  nodeId: string,
  provider: Provider,
  { topK = 2, depth = 1, maxNodes = 24, concurrency = 4 }: ExploreOptions = {},
): Promise<[string[], boolean]> {
  const created: string[] = []
  let frontier = [nodeId]
  let truncated = false
  for (let level = 0; level < depth; level++) {
    let plans = frontier.flatMap((id) => explorePlans(tree, id, topK))
    const budget = maxNodes - created.length
    if (plans.length > budget) {
      plans = plans.slice(0, Math.max(budget, 0))
      truncated = true
    }
    if (!plans.length) break
    const results = await pool(
      plans.map((p) => () => provider.complete(tree.prompt, tree.settings, p.prefix)),
      concurrency,
    )
    frontier = []
    plans.forEach((plan, i) => {
      const id = attachBranch(tree, plan, results[i])
      if (!created.includes(id)) {
        created.push(id)
        frontier.push(id)
      }
    })
    if (truncated) break
  }
  return [created, truncated]
}
