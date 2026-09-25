import type { TokenInfo, Tree, TreeNode } from './types'

/** Nodes from the root down to `nodeId` (inclusive). */
export function lineage(tree: Tree, nodeId: string): TreeNode[] {
  const chain: TreeNode[] = []
  const seen = new Set<string>()
  let current: string | null = nodeId
  while (current !== null) {
    if (seen.has(current)) throw new Error('Cycle detected in tree')
    seen.add(current)
    const node: TreeNode | undefined = tree.nodes[current]
    if (!node) throw new Error(`Unknown node ${current}`)
    chain.push(node)
    current = node.parent_id
  }
  return chain.reverse()
}

export interface PathToken extends TokenInfo {
  /** Index in the full path. */
  position: number
  /** Node that generated this token. */
  ownerId: string
}

/** Full token path of a node: `path(parent)[:fork_index] + node.tokens`. */
export function fullPath(tree: Tree, nodeId: string): PathToken[] {
  let path: PathToken[] = []
  for (const node of lineage(tree, nodeId)) {
    path = path.slice(0, node.fork_index)
    node.tokens.forEach((t, i) => {
      path.push({ ...t, position: node.fork_index + i, ownerId: node.id })
    })
  }
  return path
}

export function pathText(tokens: TokenInfo[]): string {
  return tokens.map((t) => t.token).join('')
}

/** Depth of each node (root = 0). */
export function depthOf(tree: Tree, nodeId: string): number {
  return lineage(tree, nodeId).length - 1
}

/** Descend from `nodeId` along first children to a leaf: a sensible "continue here" target. */
export function firstLeaf(tree: Tree, nodeId: string): string {
  let node = tree.nodes[nodeId]
  while (node && node.children.length > 0) node = tree.nodes[node.children[0]]
  return node ? node.id : nodeId
}

export interface LayoutNode {
  id: string
  x: number
  y: number
  depth: number
}

/**
 * Tidy left-to-right tree layout: x by depth, y by leaf order, parents centred over their
 * children. Deterministic and O(n).
 */
export function layoutTree(
  tree: Tree,
  { xGap = 280, yGap = 96 }: { xGap?: number; yGap?: number } = {},
): LayoutNode[] {
  const out: LayoutNode[] = []
  let nextLeaf = 0
  const visit = (id: string, depth: number): number => {
    const node = tree.nodes[id]
    const kids = [...node.children].sort(
      (a, b) => tree.nodes[a].fork_index - tree.nodes[b].fork_index,
    )
    let y: number
    if (kids.length === 0) {
      y = nextLeaf++ * yGap
    } else {
      const ys = kids.map((k) => visit(k, depth + 1))
      y = (ys[0] + ys[ys.length - 1]) / 2
    }
    out.push({ id, x: depth * xGap, y, depth })
    return y
  }
  visit(tree.root_id, 0)
  return out
}

export interface ForkPoint {
  position: number
  ownerId: string
  token: TokenInfo
}

/** Fork points along a path, most uncertain first. */
export function forkPoints(path: PathToken[]): ForkPoint[] {
  return path
    .filter((t) => t.is_fork)
    .map((t) => ({ position: t.position, ownerId: t.ownerId, token: t }))
    .sort((a, b) => b.token.fork_score - a.token.fork_score || a.position - b.position)
}

/** For each position on the active path, the tokens that already have explored branches. */
export function branchedTokens(tree: Tree, nodeId: string): Map<number, Set<string>> {
  const result = new Map<number, Set<string>>()
  const ids = new Set(lineage(tree, nodeId).map((n) => n.id))
  for (const node of Object.values(tree.nodes)) {
    if (node.parent_id && ids.has(node.parent_id) && node.tokens.length) {
      const set = result.get(node.fork_index) ?? new Set<string>()
      set.add(node.tokens[0].token)
      result.set(node.fork_index, set)
    }
  }
  return result
}

/** Minimal structural validation for imported trees. */
export function validateTree(value: unknown): Tree {
  const t = value as Tree
  if (!t || typeof t !== 'object') throw new Error('Not a JSON object')
  if (t.version !== 1) throw new Error('Unsupported tree version')
  if (typeof t.prompt !== 'string' || typeof t.root_id !== 'string') {
    throw new Error('Missing prompt or root_id')
  }
  if (!t.nodes || typeof t.nodes !== 'object' || !t.nodes[t.root_id]) {
    throw new Error('Root node not found')
  }
  for (const node of Object.values(t.nodes)) {
    if (!Array.isArray(node.tokens) || !Array.isArray(node.children)) {
      throw new Error(`Malformed node ${node.id}`)
    }
    if (node.parent_id !== null && !t.nodes[node.parent_id]) {
      throw new Error(`Node ${node.id} has a missing parent`)
    }
    lineage(t, node.id) // throws on cycles
  }
  return t
}
