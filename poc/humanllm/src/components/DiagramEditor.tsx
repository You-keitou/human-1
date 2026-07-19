import { useCallback, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// アーキテクチャ図・ER図を手で描いて Mermaid (markdown) に変換するエディタ
type Props = {
  onInsertMermaid: (mermaid: string) => void
}

let nodeSeq = 1

const initialNodes: Node[] = [
  { id: 'n1', position: { x: 80, y: 60 }, data: { label: 'Client' } },
  { id: 'n2', position: { x: 80, y: 200 }, data: { label: 'API Server' } },
]
const initialEdges: Edge[] = [
  { id: 'e1', source: 'n1', target: 'n2', label: 'HTTP' },
]

function toMermaid(nodes: Node[], edges: Edge[]): string {
  const lines = ['```mermaid', 'graph TD']
  const idMap = new Map<string, string>()
  nodes.forEach((n, i) => {
    const mid = `N${i + 1}`
    idMap.set(n.id, mid)
    const label = String((n.data as { label?: unknown }).label ?? n.id).replace(/"/g, "'")
    lines.push(`  ${mid}["${label}"]`)
  })
  edges.forEach((e) => {
    const s = idMap.get(e.source)
    const t = idMap.get(e.target)
    if (!s || !t) return
    const label = e.label ? `|${String(e.label).replace(/\|/g, '/')}|` : ''
    lines.push(`  ${s} -->${label} ${t}`)
  })
  lines.push('```')
  return lines.join('\n')
}

export function DiagramEditor({ onInsertMermaid }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, id: `e${Date.now()}` }, eds))
  }, [setEdges])

  const addNode = useCallback(() => {
    nodeSeq += 1
    const id = `n${Date.now()}`
    setNodes((nds) => [
      ...nds,
      {
        id,
        position: { x: 120 + (nodeSeq % 5) * 60, y: 80 + (nodeSeq % 7) * 50 },
        data: { label: `Node ${nodeSeq}` },
      },
    ])
  }, [setNodes])

  // ダブルクリックでノード名を変更
  const onNodeDoubleClick = useCallback((_e: React.MouseEvent, node: Node) => {
    const current = String((node.data as { label?: unknown }).label ?? '')
    const label = window.prompt('ノード名', current)
    if (label === null) return
    setNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, label } } : n)))
  }, [setNodes])

  const onEdgeDoubleClick = useCallback((_e: React.MouseEvent, edge: Edge) => {
    const label = window.prompt('エッジのラベル(空で削除)', String(edge.label ?? ''))
    if (label === null) return
    setEdges((eds) => eds.map((ed) => (ed.id === edge.id ? { ...ed, label: label || undefined } : ed)))
  }, [setEdges])

  const deleteSelected = useCallback(() => {
    setNodes((nds) => nds.filter((n) => !n.selected))
    setEdges((eds) => eds.filter((e) => !e.selected))
  }, [setNodes, setEdges])

  const handleInsert = () => {
    onInsertMermaid(toMermaid(nodes, edges))
  }

  const clearAll = () => {
    setNodes([])
    setEdges([])
  }

  return (
    <div className="diagram-editor">
      <div className="diagram-toolbar">
        <button className="diagram-btn" onClick={addNode}>+ ノード</button>
        <button className="diagram-btn" onClick={deleteSelected}>選択を削除</button>
        <button className="diagram-btn" onClick={clearAll}>クリア</button>
        <span className="diagram-hint">ドラッグで接続 · ダブルクリックで名前変更</span>
        <button className="diagram-insert" onClick={handleInsert}>Mermaid としてエディタに挿入 →</button>
      </div>
      <div className="diagram-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onEdgeClick={(_e, edge) => setSelectedEdgeId(edge.id === selectedEdgeId ? null : edge.id)}
          fitView
          colorMode="dark"
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background gap={16} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  )
}
