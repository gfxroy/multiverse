import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'

import { remarkTree, truncatedEntropy } from './forks'
import { validateTree } from './tree'
import type { TokenInfo, Tree } from './types'

// Compact wire format for permalinks: derived fields (probabilities, entropy, margins, fork
// flags) are dropped and recomputed on load, and logprobs are rounded.
type CompactToken = [token: string, logprob: number | null, top: [string, number][], forced?: 1]

const round = (x: number) => Math.round(x * 1000) / 1000

function compactToken(t: TokenInfo): CompactToken {
  const out: CompactToken = [
    t.token,
    t.logprob === null ? null : round(t.logprob),
    t.top.map((a) => [a.token, round(a.logprob)]),
  ]
  if (t.forced) out.push(1)
  return out
}

function expandToken([token, logprob, top, forced]: CompactToken): TokenInfo {
  const alts = top.map(([t, lp]) => ({ token: t, logprob: lp, prob: Math.exp(lp) }))
  const probs = alts.map((a) => a.prob)
  const sorted = [...probs].sort((a, b) => b - a)
  return {
    token,
    logprob,
    prob: logprob === null ? null : Math.exp(logprob),
    entropy: probs.length ? truncatedEntropy(probs) : 0,
    margin: sorted.length > 1 ? sorted[0] - sorted[1] : (sorted[0] ?? 1),
    top: alts,
    is_fork: false,
    fork_score: 0,
    forced: forced === 1,
  }
}

export function compactTree(tree: Tree): unknown {
  return {
    ...tree,
    nodes: Object.fromEntries(
      Object.entries(tree.nodes).map(([id, n]) => [
        id,
        { ...n, tokens: n.tokens.map(compactToken) },
      ]),
    ),
  }
}

export function expandTree(value: unknown): Tree {
  const raw = value as Tree & { nodes: Record<string, { tokens: CompactToken[] }> }
  const tree = {
    ...raw,
    nodes: Object.fromEntries(
      Object.entries(raw.nodes ?? {}).map(([id, n]) => [
        id,
        { ...n, tokens: (n.tokens as unknown as CompactToken[]).map(expandToken) },
      ]),
    ),
  } as Tree
  return remarkTree(validateTree(tree), tree.fork_settings)
}

const HASH_KEY = 't'

/** Encode a tree into a compact, URL-safe string. */
export function encodeTree(tree: Tree): string {
  return compressToEncodedURIComponent(JSON.stringify(compactTree(tree)))
}

export function decodeTree(encoded: string): Tree {
  const json = decompressFromEncodedURIComponent(encoded)
  if (!json) throw new Error('Could not decompress shared tree')
  return expandTree(JSON.parse(json))
}

export function permalink(tree: Tree, base = window.location.href): string {
  const url = new URL(base)
  url.hash = `${HASH_KEY}=${encodeTree(tree)}`
  return url.toString()
}

/** Read a tree from `#t=...` in the current URL, if present. */
export function treeFromHash(hash = window.location.hash): Tree | null {
  // Not URLSearchParams: lz-string's alphabet contains '+', which it would turn into ' '.
  const match = hash.replace(/^#/, '').match(new RegExp(`(?:^|&)${HASH_KEY}=([^&]+)`))
  return match ? decodeTree(match[1]) : null
}

export function downloadJson(tree: Tree, filename = 'multiverse-tree.json'): void {
  const blob = new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function readTreeFile(file: File): Promise<Tree> {
  return validateTree(JSON.parse(await file.text()))
}
