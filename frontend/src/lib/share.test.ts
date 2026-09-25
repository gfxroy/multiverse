import { describe, expect, it } from 'vitest'

import { sampleTree } from '../test/fixtures'
import { decodeTree, encodeTree, permalink, treeFromHash } from './share'

describe('share links', () => {
  it('round-trips a tree through the URL encoding', () => {
    const tree = sampleTree()
    const encoded = encodeTree(tree)
    expect(encoded).toMatch(/^[A-Za-z0-9+\-$]+$/)
    expect(decodeTree(encoded)).toEqual(tree)
  })

  it('builds and parses permalinks', () => {
    const url = permalink(sampleTree(), 'http://localhost:5173/')
    const hash = new URL(url).hash
    expect(treeFromHash(hash)?.root_id).toBe('root')
    expect(treeFromHash('#other=1')).toBeNull()
  })

  it('rejects garbage', () => {
    expect(() => decodeTree('not-a-tree')).toThrow()
  })
})
