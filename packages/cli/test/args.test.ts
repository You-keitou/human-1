// 引数パース / 終了コードのテスト(子プロセス起動、実サーバー不要)。
// 不正コマンド・不正 --shell・不正 --epochs は exit code 非 0。--help / --version は 0。
// train のバリデーションは resolveConfig を通過させる必要があるので、env に
// ダミーの HLLM_SERVER / HLLM_TOKEN を渡す(検証は ping より手前で終わり実通信しない)。

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeTempDir, rmTempDir, runCli } from './helpers/cli'

let xdg: string

// train バリデーションを ping 手前まで到達させるための最小 env(ダミーのサーバー/トークン)。
function withConfig(extra: Record<string, string> = {}): Record<string, string> {
  return {
    XDG_CONFIG_HOME: xdg,
    HLLM_SERVER: 'http://127.0.0.1:1', // 実際には接続しない(バリデーションで先に落ちる)
    HLLM_TOKEN: 'dummy',
    ...extra,
  }
}

beforeAll(() => {
  xdg = makeTempDir('args-xdg')
})

afterAll(() => {
  rmTempDir(xdg)
})

describe('--version / --help', () => {
  test('--version → exit 0 かつバージョン文字列', async () => {
    const r = await runCli(['--version'], { XDG_CONFIG_HOME: xdg })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('0.1.0')
  })

  test('引数なし → help を出して exit 0', async () => {
    const r = await runCli([], { XDG_CONFIG_HOME: xdg })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('使い方')
  })

  test('help コマンド → exit 0', async () => {
    const r = await runCli(['help'], { XDG_CONFIG_HOME: xdg })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('hllm')
  })

  test('-h → exit 0', async () => {
    const r = await runCli(['-h'], { XDG_CONFIG_HOME: xdg })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('使い方')
  })
})

describe('不正コマンド', () => {
  test('未知コマンド → exit 1', async () => {
    const r = await runCli(['bogus'], { XDG_CONFIG_HOME: xdg })
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('不明なコマンド')
  })
})

describe('設定未確定', () => {
  test('train を config 無しで実行 → exit 1', async () => {
    // env に HLLM_* を渡さない・XDG も空 → resolveConfig が null。
    const r = await runCli(['train'], { XDG_CONFIG_HOME: xdg })
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('未設定')
  })

  test('theater を config 無しで実行 → exit 1', async () => {
    const r = await runCli(['theater'], { XDG_CONFIG_HOME: xdg })
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('未設定')
  })
})

describe('train のバリデーション(config あり)', () => {
  test('不正 --shell → exit 1', async () => {
    const r = await runCli(['train', '--shell', 'bogus'], withConfig())
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('--shell')
  })

  test('--epochs 0 → exit 1', async () => {
    const r = await runCli(['train', '--shell', 'claude', '--epochs', '0'], withConfig())
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('--epochs')
  })

  test('--epochs 非整数 → exit 1', async () => {
    const r = await runCli(['train', '--shell', 'claude', '--epochs', 'abc'], withConfig())
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('--epochs')
  })

  test('正しい --shell と --dry-run は exit 0(ping/殻起動なし)', async () => {
    // dry-run は claude 呼び出し・殻起動・WS 接続・API 書き込みを行わない。
    const r = await runCli(['train', '--shell', 'codex', '--dry-run'], withConfig())
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('dry-run')
  })

  test('不正な codex --profile(パストラバーサル)→ exit 非 0 かつ ~/.codex 外に書かれない', async () => {
    const codexHome = makeTempDir('args-codex')
    try {
      // '../evil' は識別子 [A-Za-z0-9_-]+ を満たさず、CodexShell 構築時点で throw する。
      // createShell は runTrain の try より前で実行されるので main の例外経路(exit 1)へ抜ける。
      const r = await runCli(
        ['train', '--shell', 'codex', '--profile', '../evil', '--dry-run'],
        withConfig({ CODEX_HOME: codexHome }),
      )
      expect(r.exitCode).not.toBe(0)
      expect(r.stderr).toContain('--profile')
      // CODEX_HOME 内にもその親にも profile ファイルが書かれていない。
      expect(readdirSync(codexHome)).toEqual([])
      expect(existsSync(join(codexHome, '..', 'evil.config.toml'))).toBe(false)
    } finally {
      rmTempDir(codexHome)
    }
  })

  test('不正な codex --profile(スラッシュ入り)→ exit 非 0', async () => {
    const codexHome = makeTempDir('args-codex2')
    try {
      const r = await runCli(
        ['train', '--shell', 'codex', '--profile', 'a/b', '--dry-run'],
        withConfig({ CODEX_HOME: codexHome }),
      )
      expect(r.exitCode).not.toBe(0)
      expect(readdirSync(codexHome)).toEqual([])
    } finally {
      rmTempDir(codexHome)
    }
  })
})
