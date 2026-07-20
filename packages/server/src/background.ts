import type { ChatMessage } from '@human-1/shared'

// 裏方リクエストの自動応答(PoC 知見)。
// エージェントの殻が水面下で投げるメタ生成リクエストは人間に届かせず、サーバーが即座に
// 妥当なダミーを返す。判定はメッセージ本文の連結に対するパターン一致で行う。
//
//   - Claude Code: セッションタイトル生成(<session> + "Write the title")と [SUGGESTION MODE
//   - codex:       メモリ生成("Analyze this rollout" + "rollout_slug")

export type BackgroundKind = 'title' | 'suggestion' | 'rollout'

export function detectBackground(messages: ChatMessage[]): BackgroundKind | null {
  const flat = messages.map((m) => m.content).join('\n')
  if (flat.includes('<session>') && /Write the title/i.test(flat)) return 'title'
  if (flat.includes('[SUGGESTION MODE')) return 'suggestion'
  if (flat.includes('Analyze this rollout') && flat.includes('rollout_slug')) return 'rollout'
  return null
}

// Anthropic(messages)向けの定型テキスト。
export function cannedMessagesText(kind: BackgroundKind): string {
  return kind === 'title' ? '人間LLM劇場' : ' '
}

// OpenAI(responses / rollout メモリ)向けの定型 JSON テキスト。
export function cannedRolloutText(): string {
  return JSON.stringify({ raw_memory: '', rollout_summary: '', rollout_slug: '' })
}
