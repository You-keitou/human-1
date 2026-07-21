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
  kind: 'tools' | 'final' | 'none' | 'blocked'
  warnings: string[]
}

// 「/」始まりの 1 行だけ(thinking も tool も無い)= スラッシュコマンドの打ち損ねが濃厚。
// 例: 「/ex」をコマンドのつもりで打ち、そのまま final answer として送信して 0.5/10。
export function isSlashMisfire(parsed: ParsedTurn): boolean {
  if (parsed.thoughts.length || parsed.toolCalls.length) return false
  const t = parsed.finalText.trim()
  if (!t.startsWith('/')) return false
  return !t.includes('\n')
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

export function sendTurn(
  store: AppStore,
  requestId: string,
  parsed: ParsedTurn,
  opts?: { force?: boolean },
): SendOutcome {
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

  // 誤送信ガード: 「/」始まり 1 行だけの final は送信を止める(force で強行)。
  if (!opts?.force && isSlashMisfire(parsed)) {
    warnings.push(
      `「${parsed.finalText.trim()}」はスラッシュコマンドの打ち損ねの可能性があります。` +
        'final として送るなら「本文として送信」を押すか、もう一度送信してください。',
    )
    return { sent: false, kind: 'blocked', warnings }
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
