import { requestFixture } from './request'

// preview 5 画面の「状態/コンテンツ」を型付きモデルへ抽出したもの(design-spec §4)。
// 各 preview 画面はこの fixture を実コンポーネントへ流し込み、px ゲートは実装の退行検知として機能する。

// ---------- Flow1 Step1(phase=awaiting_tool_results, editorLocked=true) ----------
export type InvokeRowState = {
  icon: 'check' | 'loader-circle'
  iconColor: string
  name: string
  param: string
  status: string
  statusColor: string
}

export const flow1Fixture = {
  status: { text: 'harness がツールを実行中 · step 1 送信済み', elapsed: '0:04' },
  thinking:
    '注文システムの核は在庫と決済の整合性。まず既存スキーマを確認し、在庫引当をイベント駆動の Saga にするか判断する。',
  invokes: [
    {
      icon: 'check',
      iconColor: 'var(--tool)',
      name: 'exec_command',
      param: 'cmd: cat schema.sql | head -50',
      status: '完了 · 0.4s',
      statusColor: 'var(--tool)',
    },
    {
      icon: 'loader-circle',
      iconColor: 'var(--warn)',
      name: 'web_search',
      param: 'query: saga pattern order inventory',
      status: '実行中…',
      statusColor: 'var(--warn)',
    },
  ] satisfies InvokeRowState[],
} as const

// ---------- Flow2 Step2(phase=composing_step2, draftEmpty=true) ----------
export const flow2Fixture = {
  trainerLine: requestFixture.trainerLine,
  youStep1Preview: '<thinking> 注文システムの核は在庫と決済の整合性…',
  toolResults: [
    {
      tool: 'exec_command · exit 0 · 0.4s',
      body: 'schema.sql · 42 lines\nCREATE TABLE orders (id uuid PRIMARY KEY, user_id uuid, …',
    },
    {
      tool: 'web_search · 5 results · 1.2s',
      body: 'Saga pattern — microservices.io\n分散トランザクションを結果整合で実装するパターン…',
    },
  ],
  placeholder: 'tool の結果を踏まえて、続きの thinking / final を書く…',
} as const

// ---------- Mobile Answer(phase=ready_to_send, blocks=[thinking,tools,final]) ----------
export const mobileAnswerFixture = {
  trainer: 'ECサイトの注文システムを設計せよ。マイクロサービス構成と ER 図を示すこと。',
  thinking: '注文・在庫・決済を分離し、在庫は Saga の結果整合で扱うのが要点だ…',
  invokeValues: ['architecture.md', 'er-diagram.mmd'],
  final: 'API Gateway 配下に注文・在庫・決済の3サービス。在庫は Saga で結果整合とする。',
  mermaid: [
    'CUSTOMER ||--o{ ORDER : places',
    'ORDER ||--|{ ORDER_ITEM : has',
    'PRODUCT ||--o{ ORDER_ITEM : in',
  ],
} as const

// ---------- Mobile Step2(phase=composing_step2, draftEmpty=true) ----------
export const mobileStep2Fixture = {
  trainer:
    'EC注文システム設計の課題 — 全体アーキテクチャと ER 図を含めること。図は Whiteboard で作成し…',
  youThinking: '在庫と決済の整合性を確認。まず既存スキーマを…',
  results: [
    {
      icon: 'terminal',
      name: 'exec_command',
      meta: '· exit 0 · 0.4s',
      body: 'schema.sql · 42 lines\nCREATE TABLE orders (id uuid PRIMARY KEY, …',
    },
    {
      icon: 'search',
      name: 'web_search',
      meta: '· 5 results · 1.2s',
      body: 'Saga pattern — microservices.io\nOrchestration vs. choreography, compensating tx …',
    },
  ],
  placeholder: '結果を踏まえて続きを書く…',
} as const
