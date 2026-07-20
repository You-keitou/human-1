// hllm の設定(サーバー URL・認証トークン)の読み書き。
// 保存先は $XDG_CONFIG_HOME/hllm/config.json、無ければ ~/.config/hllm/config.json。
// 解決の優先順位: CLI フラグ > 環境変数(HLLM_SERVER / HLLM_TOKEN)> 設定ファイル。

import { chmodSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type Config = {
  server: string
  token: string
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const base = xdg?.trim() ? xdg : join(homedir(), '.config')
  return join(base, 'hllm')
}

export function configPath(): string {
  return join(configDir(), 'config.json')
}

// サーバー URL を正規化する(末尾スラッシュを落とす)。
export function normalizeServer(server: string): string {
  return server.replace(/\/+$/, '')
}

export async function loadConfig(): Promise<Partial<Config>> {
  try {
    const text = await Bun.file(configPath()).text()
    const parsed = JSON.parse(text) as Partial<Config>
    const out: Partial<Config> = {}
    if (typeof parsed.server === 'string') out.server = normalizeServer(parsed.server)
    if (typeof parsed.token === 'string') out.token = parsed.token
    return out
  } catch {
    return {}
  }
}

export async function saveConfig(config: Config): Promise<string> {
  // トークンを含むので設定ディレクトリ 0700・ファイル 0600 を明示する。
  // umask に依存しないよう、作成後に chmod で権限を確定させる。
  const dir = configDir()
  const path = configPath()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  await Bun.write(
    path,
    `${JSON.stringify({ ...config, server: normalizeServer(config.server) }, null, 2)}\n`,
  )
  chmodSync(path, 0o600)
  return path
}

// フラグ・環境変数・設定ファイルをこの順で重ねて最終設定を得る。
// 未確定(server / token のいずれか欠落)の場合は null を返す。
export async function resolveConfig(flags: {
  server?: string
  token?: string
}): Promise<Config | null> {
  const file = await loadConfig()
  const server = flags.server ?? process.env.HLLM_SERVER ?? file.server
  const token = flags.token ?? process.env.HLLM_TOKEN ?? file.token
  if (!server || !token) return null
  return { server: normalizeServer(server), token }
}
