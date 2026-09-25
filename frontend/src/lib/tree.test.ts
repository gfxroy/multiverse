import { describe, expect, it } from 'vitest'

import { sampleTree, tok } from '../test/fixtures'
import {
  branchedTokens,
  firstLeaf,
  forkPoints,
  fullPath,
  layoutTree,
  lineage,
  pathText,
  validateTree,
} from './tree'

describe('tree paths', () => {
  it('reconstructs full paths across forks', () => {
    const t = sampleTree()
    expect(pathText(fullPath(t, 'root'))).toBe('The cat sat.')
    expect(pathText(fullPath(t, 'a'))).toBe('The dog ran.')
    expect(pathText(fullPath(t, 'c'))).toBe('The dog slept')
    expect(pathText(fullPath(t, 'b'))).toBe('The cat sat!')
  })

  it('tracks positions and owners', () => {
    const path = fullPath(sampleTree(), 'c')
    expect(path.map((p) => p.position)).toEqual([0, 1, 2])
    expect(path.map((p) => p.ownerId)).toEqual(['root', 'a', 'c'])
  })

  it('returns lineage root-first and detects cycles', () => {
    const t = sampleTree()
    expect(lineage(t, 'c').map((n) => n.id)).toEqual(['root', 'a', 'c'])
    t.nodes.root.parent_id = 'c'
    expect(() => lineage(t, 'c')).toThrow(/Cycle/)
  })

  it('finds the first leaf', () => {
    expect(firstLeaf(sampleTree(), 'root')).toBe('c')
  })

  it('lists explored tokens per position on the active path', () => {
    const b = branchedTokens(sampleTree(), 'root')
    expect([...(b.get(1) ?? [])]).toEqual([' dog'])
    expect([...(b.get(3) ?? [])]).toEqual(['!'])
    expect(b.has(2)).toBe(false) // " slept" hangs off "a", which is not on root's path
  })
})

describe('layoutTree', () => {
  it('places depth on x and centres parents over children', () => {
    const layout = Object.fromEntries(
      layoutTree(sampleTree(), { xGap: 100, yGap: 10 }).map((l) => [l.id, l]),
    )
    expect(layout.root.x).toBe(0)
    expect(layout.a.x).toBe(100)
    expect(layout.c.x).toBe(200)
    // leaves get distinct rows; parents sit between their first and last child
    expect(layout.c.y).not.toBe(layout.b.y)
    expect(layout.root.y).toBe((layout.a.y + layout.b.y) / 2)
  })
})

describe('forkPoints', () => {
  it('sorts by fork score, most uncertain first', () => {
    const path = [
      {
        ...tok('a', { a: 0.5, b: 0.4 }, { is_fork: true, fork_score: 0.6 }),
        position: 0,
        ownerId: 'r',
      },
      { ...tok('c', { c: 0.9 }), position: 1, ownerId: 'r' },
      {
        ...tok('d', { d: 0.4, e: 0.39 }, { is_fork: true, fork_score: 0.9 }),
        position: 2,
        ownerId: 'r',
      },
    ]
    expect(forkPoints(path).map((f) => f.position)).toEqual([2, 0])
  })
})

describe('validateTree', () => {
  it('accepts a valid tree and rejects malformed ones', () => {
    expect(validateTree(sampleTree()).root_id).toBe('root')
    expect(() => validateTree({ ...sampleTree(), version: 2 })).toThrow()
    const broken = sampleTree()
    broken.nodes.b.parent_id = 'ghost'
    expect(() => validateTree(broken)).toThrow(/missing parent/)
    expect(() => validateTree(null)).toThrow()
  })
})
