import type { ChatMessage } from '@human-1/shared'

// 裏方リクエストの自動応答(PoC 知見)。
// エージェントの殻が水面下で投げるメタ生成リクエストは人間に届かせず、サーバーが即座に
// 妥当なダミーを返す。
//
//   - Claude Code: セッションタイトル生成(<session> + "Write the title")と [SUGGESTION MODE
//   - codex:       メモリ生成("Analyze this rollout" + "rollout_slug")
//
// 検出は「最後の user メッセージの内容のみ」にスコープする。全メッセージ横断だと、Claude Code が
// cwd の CLAUDE.md を全リクエストへ注入する(本リポジトリの CLAUDE.md は裏方検出の説明として
// これらリテラルを含む)ため、本物のタスクリクエストを誤判定して自動応答してしまう(実機で確認)。
// 上記 3 種はいずれも「最後の user メッセージ自体」がその指示なので、注入テキストや会話履歴中の
// 言及では発火しなくなる。

export type BackgroundKind = 'title' | 'suggestion' | 'rollout'

export function detectBackground(messages: ChatMessage[]): BackgroundKind | null {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const text = lastUser?.content ?? ''
  if (text.includes('<session>') && /Write the title/i.test(text)) return 'title'
  if (text.includes('[SUGGESTION MODE')) return 'suggestion'
  if (text.includes('Analyze this rollout') && text.includes('rollout_slug')) return 'rollout'
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
