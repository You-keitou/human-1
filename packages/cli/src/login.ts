// `hllm login` — サーバー URL とトークンを設定ファイルへ保存する。
// 優先順位: --server / --token フラグ > 環境変数(HLLM_SERVER / HLLM_TOKEN)> 既存設定を
// 既定値にした対話プロンプト。環境変数経由にすることで、トークンを argv(ps で可視)に
// 載せずに login できる。保存前に GET /v1/models で疎通確認する。

import { createInterface } from 'node:readline/promises'
import { ping } from './api'
import { type Config, loadConfig, normalizeServer, saveConfig } from './config'
import { bold, dim, green, info, red } from './log'

export type LoginOptions = {
  server?: string
  token?: string
  // 疎通確認をスキップ(オフライン設定用)。
  skipPing: boolean
}

// 対話プロンプト(TTY のときだけ)。ランタイム非依存に node:readline を使う
// (Bun/browser の prompt() グローバルには依存しない)。
async function ask(question: string, fallback?: string): Promise<string | null> {
  if (!process.stdin.isTTY) return fallback ?? null
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const suffix = fallback ? ` [${fallback}]` : ''
    const answer = (await rl.question(`${question}${suffix}: `)).trim()
    return answer || (fallback ?? null)
  } finally {
    rl.close()
  }
}

export async function runLogin(opts: LoginOptions): Promise<number> {
  const existing = await loadConfig()

  const server =
    opts.server ??
    process.env.HLLM_SERVER ??
    (await ask('サーバー URL', existing.server ?? 'http://127.0.0.1:8787'))
  if (!server) {
    info(red('サーバー URL が指定されていません(--server / HLLM_SERVER か対話入力が必要)'))
    return 1
  }
  const token = opts.token ?? process.env.HLLM_TOKEN ?? (await ask('認証トークン', existing.token))
  if (!token) {
    info(red('認証トークンが指定されていません(--token / HLLM_TOKEN か対話入力が必要)'))
    return 1
  }

  const config: Config = { server: normalizeServer(server), token }

  if (!opts.skipPing) {
    try {
      const models = await ping(config)
      info(green(`✓ 疎通 OK — models: ${models.join(', ') || '(none)'}`))
    } catch (e) {
      info(red(`✗ 疎通失敗: ${(e as Error).message}`))
      info(dim('  設定は保存しません。--skip-ping で疎通確認を省略できます。'))
      return 1
    }
  }

  const path = await saveConfig(config)
  info(bold(green('✓ 設定を保存しました')))
  info(dim(`  ${path}`))
  info(dim(`  server: ${config.server}`))
  return 0
}
