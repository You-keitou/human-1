// `hllm login` — サーバー URL とトークンを設定ファイルへ保存する。
// --server / --token を優先し、欠けていれば既存設定を既定値に対話プロンプトで補う。
// 保存前に GET /v1/models で疎通確認する。

import { ping } from './api'
import { type Config, loadConfig, normalizeServer, saveConfig } from './config'
import { bold, dim, green, info, red } from './log'

export type LoginOptions = {
  server?: string
  token?: string
  // 疎通確認をスキップ(オフライン設定用)。
  skipPing: boolean
}

function ask(question: string, fallback?: string): string | null {
  if (!process.stdin.isTTY) return fallback ?? null
  const suffix = fallback ? ` [${fallback}]` : ''
  const answer = prompt(`${question}${suffix}:`)
  const trimmed = answer?.trim()
  if (trimmed) return trimmed
  return fallback ?? null
}

export async function runLogin(opts: LoginOptions): Promise<number> {
  const existing = await loadConfig()

  const server = opts.server ?? ask('サーバー URL', existing.server ?? 'http://127.0.0.1:8787')
  if (!server) {
    info(red('サーバー URL が指定されていません(--server か対話入力が必要)'))
    return 1
  }
  const token = opts.token ?? ask('認証トークン', existing.token)
  if (!token) {
    info(red('認証トークンが指定されていません(--token か対話入力が必要)'))
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
