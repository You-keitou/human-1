import type { Edge, Node } from '@xyflow/react'
import type { WbNodeData } from '../lib/mermaid'

// ホワイトボードの初期グラフ(design `LhRGm` の 7 ノード: 3 service + DB + ER + class + memo)。
// 第 2 段の live 版 React Flow のシードであり、preview 静的 whiteboard の内容と同型。

export type WbFlowNode = Node<WbNodeData>

export const seedNodes: WbFlowNode[] = [
  {
    id: 'memo',
    type: 'memo',
    position: { x: 24, y: 24 },
    data: { kind: 'memo', text: '決済は外部 PSP に委譲。\n在庫は Saga で結果整合。' },
  },
  {
    id: 'gateway',
    type: 'service',
    position: { x: 300, y: 20 },
    data: { kind: 'service', label: 'API Gateway' },
  },
  {
    id: 'order',
    type: 'service',
    position: { x: 300, y: 150 },
    data: { kind: 'service', label: 'Order Service' },
  },
  {
    id: 'payment',
    type: 'service',
    position: { x: 560, y: 150 },
    data: { kind: 'service', label: 'Payment Service' },
  },
  {
    id: 'ordersdb',
    type: 'db',
    position: { x: 320, y: 270 },
    data: { kind: 'db', label: 'orders-db', engine: 'PostgreSQL' },
  },
  {
    id: 'orders-er',
    type: 'er',
    position: { x: 30, y: 240 },
    data: {
      kind: 'er',
      name: 'orders',
      fields: [
        { name: 'id', type: 'uuid PK' },
        { name: 'user_id', type: 'uuid FK' },
        { name: 'status', type: 'enum' },
        { name: 'total', type: 'int' },
      ],
    },
  },
  {
    id: 'saga',
    type: 'class',
    position: { x: 600, y: 270 },
    data: {
      kind: 'class',
      name: 'OrderSaga',
      methods: ['+ start(order)', '+ reserveStock()', '+ capturePayment()'],
    },
  },
]

export const seedEdges: Edge[] = [
  { id: 'e-gw-order', source: 'gateway', target: 'order', label: 'HTTP' },
  { id: 'e-order-pay', source: 'order', target: 'payment', label: 'Saga' },
  { id: 'e-order-db', source: 'order', target: 'ordersdb', label: 'SQL' },
  { id: 'e-er-order', source: 'orders-er', target: 'order', label: '1:N' },
]
