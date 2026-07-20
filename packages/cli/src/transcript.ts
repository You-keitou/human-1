// WS イベント列を「rollout の軌跡テキスト」へ整形する(PoC training.mjs / theater.mjs 相当)。
// トレーナー AI へ渡す軌跡と、theater の 1 行表示の両方をここで組み立てる。

import type { ToolCallItem, WsServerMessage } from '@human-1/shared'
import { bold, cyan, dim, green, magenta, yellow } from './log'

const TOOL_RESULT_RE = /^\[(tool_result|function_call_output|local_shell_call_output)\]/

function describeItem(item: ToolCallItem): string {
  if (item.type === 'function_call') return `${item.name} ${item.arguments}`.trim()
  return item.command.join(' ')
}

// request メッセージの末尾 user がツール結果なら、その本文(先頭タグを除去)を返す。
function toolResultOf(msg: Extract<WsServerMessage, { type: 'request' }>): string | null {
  const last = msg.messages[msg.messages.length - 1]
  if (last?.role !== 'user' || !TOOL_RESULT_RE.test(last.content)) return null
  return last.content
    .replace(/^\[[^\]]+\]\n?/, '')
    .slice(0, 600)
    .trim()
}

// received[fromIndex..toIndexExclusive) を軌跡テキストへ。トレーナーへ渡す入力になる。
// requestIds を渡すと、その集合に属する requestId のイベントだけを採用する
// (マーカー相関で確定した当該 rollout のリクエストに限定し、無関係イベントを除外する)。
export function buildTranscript(
  received: WsServerMessage[],
  fromIndex: number,
  toIndexExclusive: number = received.length,
  requestIds?: Set<string>,
): string {
  const lines: string[] = []
  for (let i = fromIndex; i < toIndexExclusive; i++) {
    const msg = received[i]
    if (!msg) continue
    if (requestIds && 'requestId' in msg && !requestIds.has(msg.requestId)) continue
    switch (msg.type) {
      case 'thought':
        lines.push(`[思考] ${msg.content.trim()}`)
        break
      case 'tool_called':
        for (const item of msg.items) lines.push(`[ツール実行] ${describeItem(item)}`)
        break
      case 'request': {
        const result = toolResultOf(msg)
        if (result) lines.push(`[ツール結果] ${result}`)
        break
      }
      case 'answered':
        lines.push(`[最終出力] ${msg.content.trim()}`)
        break
      default:
        break
    }
  }
  return lines.join('\n')
}

// theater 用: 1 イベントを色付き 1〜複数行に整形する。
export function renderEvent(msg: WsServerMessage): string | null {
  switch (msg.type) {
    case 'request': {
      const last = msg.messages[msg.messages.length - 1]
      const result = last && TOOL_RESULT_RE.test(last.content)
      if (result) {
        return `${dim('  ↳ ツール結果')} ${dim(
          (last.content.replace(/^\[[^\]]+\]\n?/, '') ?? '').replace(/\s+/g, ' ').slice(0, 160),
        )}`
      }
      const user = [...msg.messages].reverse().find((m) => m.role === 'user')
      const tools = msg.tools?.map((t) => t.name).join(', ')
      return [
        `${cyan(bold(`▶ request`))} ${dim(`${msg.endpoint} ${msg.requestId.slice(0, 8)}`)}`,
        `  ${(user?.content ?? '').replace(/\s+/g, ' ').slice(0, 200)}`,
        tools ? dim(`  tools: ${tools}`) : null,
      ]
        .filter((x): x is string => x !== null)
        .join('\n')
    }
    case 'thought':
      return `${magenta('◇ thought')} ${msg.content.replace(/\s+/g, ' ').trim().slice(0, 200)}`
    case 'tool_called':
      return msg.items
        .map((it) => `${green('⚙ tool')} ${describeItem(it).replace(/\s+/g, ' ').slice(0, 200)}`)
        .join('\n')
    case 'answered':
      return `${green(bold('■ answered'))} ${msg.content.replace(/\s+/g, ' ').trim().slice(0, 400)}`
    case 'timeout':
      return `${yellow(bold('⏱ timeout'))} ${dim(msg.requestId.slice(0, 8))}`
    case 'score':
      return `${cyan(bold('★ score'))} ${msg.score.value}/${msg.score.max}${
        msg.score.comment ? dim(` — ${msg.score.comment.slice(0, 120)}`) : ''
      }`
    default:
      return null
  }
}
