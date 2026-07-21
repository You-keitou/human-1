#!/usr/bin/env bun
// hllm — human-1 の CLI(login / train / free / theater)。
// トレーナー AI = claude -p、殻(codex / claude)経由で人間 LLM に出題する。
// free は採点なしの自由対話モード(AI 対話役が自由にお題を出して人間と継続対話)。
// 依存は最小限(引数パースは手書き)。ランタイムは bun。

import { resolveConfig } from './config'
import { runFree } from './free'
import { error, info } from './log'
import { runLogin } from './login'
import { isShellKind } from './shell'
import { runTheater } from './theater'
import { runTrain } from './train'

const BOOLEAN_FLAGS = new Set([
  'dry-run',
  'tui',
  'skip-ping',
  'help',
  'version',
  'debug',
  'keep-workdir',
])

type Parsed = {
  command: string | null
  positionals: string[]
  flags: Map<string, string | true>
}

function parseArgs(argv: string[]): Parsed {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()
  let command: string | null = null

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (arg === '-h') {
      flags.set('help', true)
      continue
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq !== -1) {
        flags.set(arg.slice(2, eq), arg.slice(eq + 1))
        continue
      }
      const name = arg.slice(2)
      if (BOOLEAN_FLAGS.has(name)) {
        flags.set(name, true)
        continue
      }
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(name, next)
        i++
      } else {
        flags.set(name, true)
      }
      continue
    }
    if (command === null) command = arg
    else positionals.push(arg)
  }
  return { command, positionals, flags }
}

function str(flags: Map<string, string | true>, key: string): string | undefined {
  const v = flags.get(key)
  return typeof v === 'string' ? v : undefined
}

const HELP = `hllm — human-1 訓練 CLI

使い方:
  hllm login   [--server URL] [--token TOKEN] [--skip-ping]
  hllm train   [ドメイン] [--shell codex|claude] [--epochs N] [--trainer-model M]
               [--profile NAME] [--cwd DIR] [--keep-workdir] [--timeout MS] [--dry-run] [--tui]
  hllm free    [テーマ] [--shell codex|claude] [--cwd DIR] [--keep-workdir] [--timeout MS]
  hllm theater
  hllm help | --version

共通フラグ:
  --server URL     サーバー URL(未指定なら env HLLM_SERVER / 設定ファイル)
  --token TOKEN    認証トークン(未指定なら env HLLM_TOKEN / 設定ファイル)

train フラグ:
  --cwd DIR        殻の作業ディレクトリ(未指定なら中立の一時 dir を作り訓練後に削除)
  --keep-workdir   中立一時 dir を削除せず残す

例:
  hllm login --server https://human-1.example.workers.dev --token s3cret
  hllm theater
  hllm train "システム設計" --shell claude --epochs 3
  hllm train --shell codex --dry-run
`

async function main(): Promise<number> {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2))

  if (flags.get('version') === true) {
    info('hllm 0.1.0')
    return 0
  }
  if (command === null || command === 'help' || flags.get('help') === true) {
    info(HELP)
    return 0
  }

  const flagServer = str(flags, 'server')
  const flagToken = str(flags, 'token')

  switch (command) {
    case 'login':
      return runLogin({
        server: flagServer,
        token: flagToken,
        skipPing: flags.get('skip-ping') === true,
      })

    case 'theater': {
      const config = await resolveConfig({ server: flagServer, token: flagToken })
      if (!config) {
        error(
          'サーバー/トークンが未設定です。`hllm login` を実行するか --server/--token を指定してください。',
        )
        return 1
      }
      await runTheater({ config })
      return 0
    }

    case 'train': {
      const config = await resolveConfig({ server: flagServer, token: flagToken })
      if (!config) {
        error(
          'サーバー/トークンが未設定です。`hllm login` を実行するか --server/--token を指定してください。',
        )
        return 1
      }
      const shellFlag = str(flags, 'shell') ?? 'claude'
      if (!isShellKind(shellFlag)) {
        error(`--shell は codex か claude を指定してください(指定: ${shellFlag})`)
        return 1
      }
      const epochs = Number(str(flags, 'epochs') ?? 3)
      if (!Number.isInteger(epochs) || epochs < 1) {
        error('--epochs は 1 以上の整数を指定してください')
        return 1
      }
      const timeout = Number(str(flags, 'timeout') ?? 45 * 60 * 1000)
      return await runTrain({
        config,
        shell: shellFlag,
        domain: positionals[0] ?? 'プログラミングとシステム設計の基礎',
        epochs,
        trainerModel: str(flags, 'trainer-model'),
        profile: str(flags, 'profile') ?? 'hllm',
        // --cwd 未指定なら runTrain が中立の一時ディレクトリを作る(渡さない)。
        cwd: str(flags, 'cwd'),
        keepWorkdir: flags.get('keep-workdir') === true,
        rolloutTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 45 * 60 * 1000,
        dryRun: flags.get('dry-run') === true,
        tui: flags.get('tui') === true,
      })
    }

    case 'free': {
      const config = await resolveConfig({ server: flagServer, token: flagToken })
      if (!config) {
        error(
          'サーバー/トークンが未設定です。`hllm login` を実行するか --server/--token を指定してください。',
        )
        return 1
      }
      const shellFlag = str(flags, 'shell') ?? 'claude'
      if (!isShellKind(shellFlag)) {
        error(`--shell は codex か claude を指定してください(指定: ${shellFlag})`)
        return 1
      }
      const timeout = Number(str(flags, 'timeout') ?? 45 * 60 * 1000)
      return await runFree({
        config,
        shell: shellFlag,
        theme: positionals[0],
        cwd: str(flags, 'cwd'),
        keepWorkdir: flags.get('keep-workdir') === true,
        timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 45 * 60 * 1000,
      })
    }

    default:
      error(`不明なコマンド: ${command}`)
      info(HELP)
      return 1
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    // トークン等の漏洩を避け、既定は 1 行メッセージ。--debug 指定時のみ生スタックを出す。
    const err = e as Error
    if (process.argv.includes('--debug')) error(err.stack ?? String(err))
    else error(err.message || String(err))
    process.exit(1)
  },
)
