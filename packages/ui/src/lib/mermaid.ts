// ホワイトボードのグラフ → Mermaid 変換(PoC DiagramEditor.tsx の toMermaid を進化)。
// カスタムノード(付箋・サービス・DB・ER エンティティ・クラス)を
//   graph / erDiagram / classDiagram の 3 記法へ落とす。挿入時は ```mermaid フェンスで囲う。

export type WbField = { name: string; type: string }

export type WbNodeData =
  | { kind: 'memo'; text: string }
  | { kind: 'service'; label: string }
  | { kind: 'db'; label: string; engine?: string }
  | { kind: 'er'; name: string; fields: WbField[] }
  | { kind: 'class'; name: string; methods: string[] }

export type WbNode = { id: string; data: WbNodeData }
export type WbEdge = { source: string; target: string; label?: string }

export type MermaidMode = 'graph' | 'er' | 'class'

// ノード構成から既定の記法を推定する(ER が主なら erDiagram、class が主なら classDiagram、他は graph)。
export function detectMode(nodes: WbNode[]): MermaidMode {
  const hasEr = nodes.some((n) => n.data.kind === 'er')
  const hasClass = nodes.some((n) => n.data.kind === 'class')
  if (hasEr && !hasClass) return 'er'
  if (hasClass && !hasEr) return 'class'
  return 'graph'
}

function nodeLabel(data: WbNodeData): string {
  switch (data.kind) {
    case 'memo':
      return data.text
    case 'service':
      return data.label
    case 'db':
      return data.label
    case 'er':
      return data.name
    case 'class':
      return data.name
  }
}

// Mermaid のノード ID として使える識別子(英数のみ、先頭は英字)。名前を安定 ID へ正規化する。
function safeId(raw: string, fallback: string): string {
  const s = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '')
  return /^[A-Za-z]/.test(s) ? s : fallback
}

function graphDiagram(nodes: WbNode[], edges: WbEdge[]): string {
  const lines = ['graph TD']
  const idMap = new Map<string, string>()
  nodes.forEach((n, i) => {
    const mid = safeId(nodeLabel(n.data), `N${i + 1}`)
    // 衝突回避: 既出 ID なら連番を付す。
    const uniq = idMap.has(mid) ? `${mid}_${i}` : mid
    idMap.set(n.id, uniq)
    const label = nodeLabel(n.data).replace(/"/g, "'").replace(/\n/g, ' ')
    lines.push(`  ${uniq}["${label}"]`)
  })
  for (const e of edges) {
    const s = idMap.get(e.source)
    const t = idMap.get(e.target)
    if (!s || !t) continue
    const label = e.label ? `|${e.label.replace(/\|/g, '/')}|` : ''
    lines.push(`  ${s} -->${label} ${t}`)
  }
  return lines.join('\n')
}

function erDiagram(nodes: WbNode[], edges: WbEdge[]): string {
  const lines = ['erDiagram']
  const idMap = new Map<string, string>()
  for (const n of nodes) {
    if (n.data.kind !== 'er') continue
    const name = safeId(n.data.name, 'ENTITY').toUpperCase()
    idMap.set(n.id, name)
    lines.push(`  ${name} {`)
    for (const f of n.data.fields) {
      lines.push(`    ${safeId(f.type, 'string')} ${safeId(f.name, 'field')}`)
    }
    lines.push('  }')
  }
  for (const e of edges) {
    const s = idMap.get(e.source)
    const t = idMap.get(e.target)
    if (!s || !t) continue
    const label = e.label ? e.label.replace(/[:"]/g, ' ').trim() || 'relates' : 'relates'
    lines.push(`  ${s} ||--o{ ${t} : ${label}`)
  }
  return lines.join('\n')
}

function classDiagram(nodes: WbNode[], edges: WbEdge[]): string {
  const lines = ['classDiagram']
  const idMap = new Map<string, string>()
  for (const n of nodes) {
    if (n.data.kind !== 'class') continue
    const name = safeId(n.data.name, 'Class')
    idMap.set(n.id, name)
    lines.push(`  class ${name} {`)
    for (const m of n.data.methods) {
      lines.push(`    ${m.replace(/[{}]/g, '')}`)
    }
    lines.push('  }')
  }
  for (const e of edges) {
    const s = idMap.get(e.source)
    const t = idMap.get(e.target)
    if (!s || !t) continue
    lines.push(`  ${s} --> ${t}`)
  }
  return lines.join('\n')
}

export function toMermaidBody(nodes: WbNode[], edges: WbEdge[], mode: MermaidMode): string {
  if (mode === 'er') return erDiagram(nodes, edges)
  if (mode === 'class') return classDiagram(nodes, edges)
  return graphDiagram(nodes, edges)
}

// エディタへ挿入する形(```mermaid フェンス付き)。
export function toMermaidFenced(nodes: WbNode[], edges: WbEdge[], mode: MermaidMode): string {
  return ['```mermaid', toMermaidBody(nodes, edges, mode), '```'].join('\n')
}
