import type { ParsedTurn, ToolCallItem } from '@human-1/shared'
import type { AppStore } from './store'

// ParsedTurn(shared の parseRawOutput 出力)を WS メッセージへ変換して送信する。
//  - thinking → reasoning(本文/tool より前に配信)
//  - 並列複数 tool call → { type:'tool_calls', items }(function_call へ変換・callId 生成)
//  - final → { type:'response' }
//  - **決定事項**: delta streaming の UI ボタンは出さない(reasoning + final のみ)
//  - UI ルール: tool call と final の同時送信は不可 → tool を優先し本文は破棄(警告)

export type SendOutcome = {
  sent: boolean
  kind: 'tools' | 'final' | 'none'
  warnings: string[]
}

// ParsedToolCall → ToolCallItem(方言はサーバー側で endpoint に射影されるため function_call で統一)。
export function toToolCallItems(parsed: ParsedTurn): ToolCallItem[] {
  return parsed.toolCalls.map((tc) => ({
    type: 'function_call' as const,
    callId: crypto.randomUUID(),
    name: tc.name,
    arguments: JSON.stringify(tc.args),
  }))
}

export function sendTurn(store: AppStore, requestId: string, parsed: ParsedTurn): SendOutcome {
  const warnings = [...parsed.warnings]
  let finalText = parsed.finalText
  const hasTools = parsed.toolCalls.length > 0

  if (hasTools && finalText) {
    warnings.push(
      'tool call と final output の同時送信は不可 — tool call を優先し、本文は破棄しました',
    )
    finalText = ''
  }

  if (!parsed.thoughts.length && !hasTools && !finalText) {
    return { sent: false, kind: 'none', warnings }
  }

  // reasoning は tool/final より前に配信する(サーバーは本文開始前の思考のみ意味を持つ)。
  for (const thought of parsed.thoughts) {
    store.sendReasoning(requestId, `${thought}\n`)
  }

  if (hasTools) {
    store.sendToolCalls(requestId, toToolCallItems(parsed))
    return { sent: true, kind: 'tools', warnings }
  }
  if (finalText) {
    store.sendResponse(requestId, finalText)
    return { sent: true, kind: 'final', warnings }
  }
  // thinking のみ(tool/final なし)。reasoning は送ったが確定はしない。
  return { sent: true, kind: 'none', warnings }
}
