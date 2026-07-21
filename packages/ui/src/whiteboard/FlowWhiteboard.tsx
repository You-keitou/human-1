import {
  addEdge,
  type Connection,
  type Edge,
  type Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './flow.css'
import { type ReactElement, useCallback, useState } from 'react'
import { seedEdges, seedNodes, type WbFlowNode } from '../fixtures/whiteboard'
import {
  detectMode,
  type MermaidMode,
  toMermaidFenced,
  type WbEdge,
  type WbNode,
  type WbNodeData,
} from '../lib/mermaid'
import { DotGridBackground } from './DotGridBackground'
import { nodeTypes } from './nodes'

type Props = { onInsertMermaid: (mermaid: string) => void }

let seq = 100

const PALETTE: { kind: WbNodeData['kind']; label: string; make: () => WbNodeData }[] = [
  { kind: 'memo', label: '付箋', make: () => ({ kind: 'memo', text: 'メモ' }) },
  { kind: 'service', label: 'サービス', make: () => ({ kind: 'service', label: 'Service' }) },
  { kind: 'db', label: 'DB', make: () => ({ kind: 'db', label: 'db', engine: 'PostgreSQL' }) },
  {
    kind: 'er',
    label: 'ER',
    make: () => ({ kind: 'er', name: 'entity', fields: [{ name: 'id', type: 'uuid PK' }] }),
  },
  {
    kind: 'class',
    label: 'クラス',
    make: () => ({ kind: 'class', name: 'Class', methods: ['+ method()'] }),
  },
]

// React Flow の Node<WbNodeData> を Mermaid 変換用の軽量 WbNode/WbEdge へ落とす。
function toGraph(nodes: Node[], edges: Edge[]): { nodes: WbNode[]; edges: WbEdge[] } {
  return {
    nodes: nodes.map((n) => ({ id: n.id, data: n.data as WbNodeData })),
    edges: edges.map((e) => ({
      source: e.source,
      target: e.target,
      label: typeof e.label === 'string' ? e.label : undefined,
    })),
  }
}

export function FlowWhiteboard({ onInsertMermaid }: Props): ReactElement {
  const [nodes, setNodes, onNodesChange] = useNodesState<WbFlowNode>(seedNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(seedEdges)
  const [mode, setMode] = useState<MermaidMode | 'auto'>('auto')

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: `e${Date.now()}` }, eds)),
    [setEdges],
  )

  const addNode = useCallback(
    (make: () => WbNodeData, kind: WbNodeData['kind']) => {
      seq += 1
      const id = `${kind}-${seq}`
      setNodes((nds) => [
        ...nds,
        {
          id,
          type: kind,
          position: { x: 120 + (seq % 5) * 40, y: 90 + (seq % 6) * 44 },
          data: make(),
        } as WbFlowNode,
      ])
    },
    [setNodes],
  )

  const deleteSelected = useCallback(() => {
    setNodes((nds) => nds.filter((n) => !n.selected))
    setEdges((eds) => eds.filter((e) => !e.selected))
  }, [setNodes, setEdges])

  const insert = useCallback(() => {
    const g = toGraph(nodes, edges)
    const m = mode === 'auto' ? detectMode(g.nodes) : mode
    onInsertMermaid(toMermaidFenced(g.nodes, g.edges, m))
  }, [nodes, edges, mode, onInsertMermaid])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        {PALETTE.map((p) => (
          <button
            key={p.kind}
            type="button"
            onClick={() => addNode(p.make, p.kind)}
            style={paletteBtn}
          >
            + {p.label}
          </button>
        ))}
        <button type="button" onClick={deleteSelected} style={paletteBtn}>
          選択を削除
        </button>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          記法{' '}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as MermaidMode | 'auto')}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
          >
            <option value="auto">auto</option>
            <option value="graph">graph</option>
            <option value="er">erDiagram</option>
            <option value="class">classDiagram</option>
          </select>
        </label>
        <button type="button" onClick={insert} style={insertBtn}>
          Mermaid として挿入 →
        </button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <DotGridBackground />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          deleteKeyCode={['Backspace', 'Delete']}
          style={{ background: 'transparent' }}
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </div>
  )
}

const paletteBtn = {
  fontFamily: 'var(--font-ui)',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  background: 'var(--surface)',
  border: '1px solid var(--border-strong)',
  borderRadius: 6,
  padding: '5px 10px',
  cursor: 'pointer',
} as const

const insertBtn = {
  fontFamily: 'var(--font-ui)',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--on-accent)',
  background: 'var(--accent)',
  border: 'none',
  borderRadius: 6,
  padding: '7px 14px',
  cursor: 'pointer',
} as const
