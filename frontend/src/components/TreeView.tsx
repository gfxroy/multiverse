import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import clsx from 'clsx'
import { memo, useEffect, useMemo } from 'react'

import { visibleToken } from '../lib/color'
import { layoutTree, lineage, pathText } from '../lib/tree'
import type { TreeNode } from '../lib/types'
import { useStore } from '../store'

type BranchData = {
  node: TreeNode
  active: boolean
  onPath: boolean
  depth: number
}

type BranchFlowNode = Node<BranchData, 'branch'>

const BranchNode = memo(function BranchNode({ data }: NodeProps<BranchFlowNode>) {
  const { node, active, onPath } = data
  const isRoot = node.parent_id === null
  const forced = isRoot ? null : node.tokens[0]
  const rest = isRoot ? node.tokens : node.tokens.slice(1)
  const snippet = pathText(rest).trim()
  const forks = node.tokens.filter((t) => t.is_fork).length
  const meanH = node.tokens.reduce((a, t) => a + t.entropy, 0) / Math.max(node.tokens.length, 1)

  return (
    <div
      className={clsx(
        'w-[240px] animate-pop rounded-xl border p-3 text-left transition-all duration-200',
        active
          ? 'border-white/80 bg-white/[0.09] shadow-lg shadow-black/40'
          : onPath
            ? 'border-white/25 bg-[#161618]/95'
            : 'border-white/[0.08] bg-[#121214]/90 hover:border-white/20',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-white/60"
      />
      <div className="mb-1.5 flex items-center gap-1.5">
        {isRoot ? (
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-neutral-200 uppercase">
            root
          </span>
        ) : (
          <>
            <span className="max-w-[120px] truncate rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-neutral-100">
              {visibleToken(forced!.token)}
            </span>
            <span className="text-[10px] text-neutral-400">@{node.fork_index}</span>
            {forced!.prob !== null && (
              <span className="text-[10px] text-neutral-400">{(forced!.prob * 100).toFixed(0)}%</span>
            )}
          </>
        )}
        <span className="ml-auto text-[10px] text-neutral-400">{node.tokens.length} tok</span>
      </div>
      <p className="line-clamp-2 font-mono text-[11px] leading-snug text-neutral-300">
        {snippet || <span className="text-neutral-500">(empty)</span>}
      </p>
      <div className="mt-1.5 flex gap-2 text-[10px] text-neutral-400">
        <span>H̄ {meanH.toFixed(2)}</span>
        {forks > 0 && <span className="text-neutral-300">{forks} forks</span>}
        {node.children.length > 0 && <span>{node.children.length} branches</span>}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-white/60"
      />
    </div>
  )
})

const nodeTypes = { branch: BranchNode }

function FitOnChange({ count }: { count: number }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const t = setTimeout(() => fitView({ duration: 500, padding: 0.2, maxZoom: 1.1 }), 60)
    return () => clearTimeout(t)
  }, [count, fitView])
  return null
}

function Flow() {
  const tree = useStore((s) => s.tree)
  const activeId = useStore((s) => s.activeId)
  const setActive = useStore((s) => s.setActive)

  const { nodes, edges } = useMemo(() => {
    if (!tree || !activeId) return { nodes: [] as BranchFlowNode[], edges: [] as Edge[] }
    const onPath = new Set(lineage(tree, activeId).map((n) => n.id))
    const layout = layoutTree(tree)
    const nodes: BranchFlowNode[] = layout.map((l) => ({
      id: l.id,
      type: 'branch',
      position: { x: l.x, y: l.y },
      data: {
        node: tree.nodes[l.id],
        active: l.id === activeId,
        onPath: onPath.has(l.id),
        depth: l.depth,
      },
    }))
    const edges: Edge[] = Object.values(tree.nodes)
      .filter((n) => n.parent_id !== null)
      .map((n) => {
        const hot = onPath.has(n.id)
        return {
          id: `${n.parent_id}->${n.id}`,
          source: n.parent_id!,
          target: n.id,
          type: 'smoothstep',
          animated: hot,
          style: { stroke: hot ? '#ffffff' : '#333338', strokeWidth: hot ? 2 : 1 },
        }
      })
    return { nodes, edges }
  }, [tree, activeId])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => setActive(n.id)}
      nodesDraggable={false}
      nodesConnectable={false}
      colorMode="dark"
      fitView
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#222226" />
      <Controls showInteractive={false} />
      <FitOnChange count={nodes.length} />
    </ReactFlow>
  )
}

export function TreeView() {
  const tree = useStore((s) => s.tree)
  const count = tree ? Object.keys(tree.nodes).length : 0
  return (
    <section
      className="flex min-h-[320px] flex-1 flex-col overflow-hidden panel"
      data-testid="tree-view"
    >
      <header className="flex items-center gap-3 border-b border-white/5 px-5 py-3">
        <h2 className="panel-title">Multiverse tree</h2>
        <span className="text-[11px] text-slate-500">
          {count} {count === 1 ? 'branch' : 'branches'} · click a node to switch · scroll to zoom
        </span>
      </header>
      <div className="relative min-h-0 flex-1">
        {tree ? (
          <ReactFlowProvider>
            <Flow />
          </ReactFlowProvider>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-600">
            Branches you create will grow here.
          </div>
        )}
      </div>
    </section>
  )
}
