export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ToolCallItem =
  | { type: 'function_call'; callId: string; name: string; arguments: string }
  | { type: 'local_shell_call'; callId: string; command: string[]; workingDirectory: string | null }

export type ToolInfo = {
  name: string
  description?: string
  parameters?: unknown
}

// Server → Frontend
export type WsRequestMessage = {
  type: 'request'
  requestId: string
  messages: ChatMessage[]
  model: string
  createdAt: number
  tools?: ToolInfo[]
}

export type WsTimeoutMessage = {
  type: 'timeout'
  requestId: string
}

// 以下は劇場ドライバーなどの観測者向け通知。
// 逆転構成では、出題者AI(人間役)も普段の人間と同様にセッションの全てを
// 見られる必要があるため、思考・ツール実行・回答確定をすべて配信する。
export type WsAnsweredMessage = {
  type: 'answered'
  requestId: string
  content: string
}

export type WsThoughtMessage = {
  type: 'thought'
  requestId: string
  content: string
}

export type WsToolCalledMessage = {
  type: 'tool_called'
  requestId: string
  item: ToolCallItem
}

export type WsServerMessage =
  | WsRequestMessage
  | WsTimeoutMessage
  | WsAnsweredMessage
  | WsThoughtMessage
  | WsToolCalledMessage

// Frontend → Server
export type WsResponseMessage =
  | { type: 'response'; requestId: string; content: string }
  | { type: 'delta'; requestId: string; content: string }
  | { type: 'reasoning'; requestId: string; content: string }
  | { type: 'function_call'; requestId: string; callId: string; name: string; arguments: string }
  | { type: 'local_shell_call'; requestId: string; callId: string; command: string[]; workingDirectory: string | null }
