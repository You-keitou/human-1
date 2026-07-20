// human-1 共通型定義。
// PoC(poc/humanllm/shared/types.ts)から移植し、並列複数 tool call と
// 訓練 run / rollout / スコアの永続化型を追加したもの。

// ---------- チャット ----------

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ---------- ツール ----------

export type ToolInfo = {
  name: string
  description?: string
  parameters?: unknown
}

// エンドポイント方言を保ったままの tool call 表現。
// function_call: /v1/responses(codex)・/v1/messages(Claude Code)共通
// local_shell_call: codex の組み込みシェル
export type ToolCallItem =
  | { type: 'function_call'; callId: string; name: string; arguments: string }
  | { type: 'local_shell_call'; callId: string; command: string[]; workingDirectory: string | null }

// ---------- WebSocket: Server → Client ----------

export type ApiEndpoint = 'responses' | 'messages'

export type WsRequestMessage = {
  type: 'request'
  requestId: string
  endpoint: ApiEndpoint
  messages: ChatMessage[]
  model: string
  createdAt: number
  tools?: ToolInfo[]
}

export type WsTimeoutMessage = {
  type: 'timeout'
  requestId: string
}

// 以下は観測者(トレーナー AI・theater)向け通知。
// トレーナーもセッションの全てを見られる必要があるため、
// 思考・ツール実行・回答確定をすべて配信する。
export type WsThoughtMessage = {
  type: 'thought'
  requestId: string
  content: string
}

export type WsToolCalledMessage = {
  type: 'tool_called'
  requestId: string
  items: ToolCallItem[]
}

export type WsAnsweredMessage = {
  type: 'answered'
  requestId: string
  content: string
}

export type WsScoreMessage = {
  type: 'score'
  rolloutId: string
  score: Score
}

export type WsServerMessage =
  | WsRequestMessage
  | WsTimeoutMessage
  | WsThoughtMessage
  | WsToolCalledMessage
  | WsAnsweredMessage
  | WsScoreMessage

// ---------- WebSocket: Client → Server ----------

export type WsResponseMessage =
  | { type: 'response'; requestId: string; content: string }
  | { type: 'delta'; requestId: string; content: string }
  | { type: 'reasoning'; requestId: string; content: string }
  | { type: 'tool_calls'; requestId: string; items: ToolCallItem[] }

// ---------- 訓練の永続化(Durable Object ストレージ) ----------

export type Score = {
  value: number
  max: number
  comment?: string
  at: number
}

export type Rollout = {
  id: string
  runId: string
  task: string
  score?: Score
  startedAt: number
  endedAt?: number
}

export type TrainingRun = {
  id: string
  title: string
  createdAt: number
  rolloutIds: string[]
}
