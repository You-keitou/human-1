// 設定の解決優先順位のユニットテスト(サーバー不要)。
// 仕様(CLAUDE.md / config.ts の doc): CLI フラグ > 環境変数(HLLM_SERVER/HLLM_TOKEN)> 設定ファイル。
// XDG_CONFIG_HOME を一時 dir に向け、本物の ~/.config を汚さない。

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  configDir,
  configPath,
  loadConfig,
  normalizeServer,
  resolveConfig,
  saveConfig,
} from '../src/config'
import { makeTempDir, rmTempDir } from './helpers/cli'

let dir: string
const saved: Record<string, string | undefined> = {}

// 設定ファイルを XDG_CONFIG_HOME/hllm/config.json に書く。
function writeConfigFile(server: string, token: string): void {
  const hllmDir = join(dir, 'hllm')
  mkdirSync(hllmDir, { recursive: true })
  writeFileSync(join(hllmDir, 'config.json'), JSON.stringify({ server, token }))
}

beforeEach(() => {
  dir = makeTempDir('config')
  for (const k of ['XDG_CONFIG_HOME', 'HLLM_SERVER', 'HLLM_TOKEN']) saved[k] = process.env[k]
  process.env.XDG_CONFIG_HOME = dir
  process.env.HLLM_SERVER = undefined
  process.env.HLLM_TOKEN = undefined
  delete process.env.HLLM_SERVER
  delete process.env.HLLM_TOKEN
})

afterEach(() => {
  for (const k of ['XDG_CONFIG_HOME', 'HLLM_SERVER', 'HLLM_TOKEN']) {
    const v = saved[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmTempDir(dir)
})

describe('normalizeServer', () => {
  test('末尾スラッシュを落とす', () => {
    expect(normalizeServer('http://x/')).toBe('http://x')
    expect(normalizeServer('http://x///')).toBe('http://x')
    expect(normalizeServer('http://x')).toBe('http://x')
  })
})

describe('configPath は XDG_CONFIG_HOME 配下', () => {
  test('XDG_CONFIG_HOME/hllm/config.json', () => {
    expect(configPath()).toBe(join(dir, 'hllm', 'config.json'))
  })
})

describe('save/load ラウンドトリップ', () => {
  test('保存した値を読み戻せる(server は正規化)', async () => {
    const path = await saveConfig({ server: 'http://127.0.0.1:9/', token: 'tok' })
    expect(path).toBe(configPath())
    const loaded = await loadConfig()
    expect(loaded.server).toBe('http://127.0.0.1:9')
    expect(loaded.token).toBe('tok')
  })

  test('設定ファイルが無ければ空オブジェクト', async () => {
    expect(await loadConfig()).toEqual({})
  })

  test('保存後のパーミッションは dir 0700 / file 0600(トークン保護)', async () => {
    const path = await saveConfig({ server: 'http://127.0.0.1:9', token: 'secret-token' })
    // 下位 9 bit(rwxrwxrwx)だけを見る。
    expect(statSync(configDir()).mode & 0o777).toBe(0o700)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })
})

describe('resolveConfig の優先順位', () => {
  test('設定ファイルのみ → ファイル値を採用', async () => {
    writeConfigFile('http://file-server', 'file-token')
    const c = await resolveConfig({})
    expect(c).toEqual({ server: 'http://file-server', token: 'file-token' })
  })

  test('環境変数 > 設定ファイル', async () => {
    writeConfigFile('http://file-server', 'file-token')
    process.env.HLLM_SERVER = 'http://env-server'
    process.env.HLLM_TOKEN = 'env-token'
    const c = await resolveConfig({})
    expect(c).toEqual({ server: 'http://env-server', token: 'env-token' })
  })

  test('フラグ > 環境変数 > 設定ファイル', async () => {
    writeConfigFile('http://file-server', 'file-token')
    process.env.HLLM_SERVER = 'http://env-server'
    process.env.HLLM_TOKEN = 'env-token'
    const c = await resolveConfig({ server: 'http://flag-server/', token: 'flag-token' })
    expect(c).toEqual({ server: 'http://flag-server', token: 'flag-token' })
  })

  test('server と token の一方でも欠ければ null', async () => {
    process.env.HLLM_SERVER = 'http://only-server'
    expect(await resolveConfig({})).toBeNull()
    delete process.env.HLLM_SERVER
    process.env.HLLM_TOKEN = 'only-token'
    expect(await resolveConfig({})).toBeNull()
  })

  test('何も無ければ null', async () => {
    expect(await resolveConfig({})).toBeNull()
  })
})
