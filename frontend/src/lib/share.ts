import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'

import { validateTree } from './tree'
import type { Tree } from './types'

const HASH_KEY = 't'

/** Encode a tree into a compact, URL-safe string. */
export function encodeTree(tree: Tree): string {
  return compressToEncodedURIComponent(JSON.stringify(tree))
}

export function decodeTree(encoded: string): Tree {
  const json = decompressFromEncodedURIComponent(encoded)
  if (!json) throw new Error('Could not decompress shared tree')
  return validateTree(JSON.parse(json))
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
