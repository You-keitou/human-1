import { Handle, type NodeProps, Position } from '@xyflow/react'
import type { ReactElement } from 'react'
import type { WbNodeData } from '../lib/mermaid'

// React Flow カスタムノード。デザインの見た目(付箋・サービス・DB・ER エンティティ・クラス)を
// 機能色トークンで再現する。接続用に上下の Handle を付ける。

const HANDLE_STYLE = { width: 8, height: 8, background: 'var(--border-strong)' } as const

function Handles(): ReactElement {
  return (
    <>
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    </>
  )
}

type Data<K extends WbNodeData['kind']> = Extract<WbNodeData, { kind: K }>

export function MemoNode({ data }: NodeProps): ReactElement {
  const d = data as Data<'memo'>
  return (
    <div
      style={{
        width: 190,
        padding: '10px 12px',
        borderRadius: 6,
        borderLeft: '2px solid var(--memo)',
        background: 'var(--memo-soft)',
        color: 'var(--memo)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
      }}
    >
      <Handles />
      {d.text}
    </div>
  )
}

export function ServiceNode({ data }: NodeProps): ReactElement {
  const d = data as Data<'service'>
  return (
    <div
      style={{
        minWidth: 160,
        height: 46,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        borderLeft: '2px solid var(--accent)',
        background: 'var(--accent-soft)',
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
        fontSize: 12,
        color: 'var(--text-primary)',
      }}
    >
      <Handles />
      {d.label}
    </div>
  )
}

export function DbNode({ data }: NodeProps): ReactElement {
  const d = data as Data<'db'>
  return (
    <div
      style={{
        width: 130,
        padding: '14px 10px 10px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        borderRadius: '50% / 14px',
        border: '1.5px solid var(--tool)',
        background: 'var(--tool-soft)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <Handles />
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{d.label}</span>
      {d.engine && <span style={{ fontSize: 9, color: 'var(--tool)' }}>{d.engine}</span>}
    </div>
  )
}

export function ErNode({ data }: NodeProps): ReactElement {
  const d = data as Data<'er'>
  return (
    <div
      style={{
        width: 210,
        borderRadius: 6,
        border: '1.5px solid var(--xml)',
        background: 'var(--surface)',
        overflow: 'hidden',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <Handles />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: 'var(--xml-soft)',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--xml)',
        }}
      >
        <span>{d.name}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>entity</span>
      </div>
      {d.fields.map((f) => (
        <div
          key={f.name}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderTop: '1px solid var(--border)',
            fontSize: 11,
          }}
        >
          <span>{f.name}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{f.type}</span>
        </div>
      ))}
    </div>
  )
}

export function ClassNode({ data }: NodeProps): ReactElement {
  const d = data as Data<'class'>
  return (
    <div
      style={{
        width: 220,
        borderRadius: 6,
        border: '1.5px solid var(--thinking)',
        background: 'var(--surface)',
        overflow: 'hidden',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <Handles />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: 'var(--thinking-soft)',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--thinking)',
        }}
      >
        <span>{d.name}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>class</span>
      </div>
      {d.methods.map((m) => (
        <div
          key={m}
          style={{
            padding: '4px 10px',
            borderTop: '1px solid var(--border)',
            fontSize: 11,
            color: 'var(--text-secondary)',
          }}
        >
          {m}
        </div>
      ))}
    </div>
  )
}

export const nodeTypes = {
  memo: MemoNode,
  service: ServiceNode,
  db: DbNode,
  er: ErNode,
  class: ClassNode,
}
