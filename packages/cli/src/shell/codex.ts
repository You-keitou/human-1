// codex を殻として使う。codex 0.144+ は別ファイル方式のプロファイル
// `~/.codex/<name>.config.toml` を `--profile <name>` で読み込む。
//   ヘッドレス: codex --profile <name> exec [resume <id>] --skip-git-repo-check <prompt>
//   TUI:       codex --profile <name>
// PoC 知見: model_supports_reasoning_summaries=true で thinking がスピナー横に出る。
// stream_idle_timeout_ms を延ばして人間の遅延に耐える。認証は bearer_token_env_var 経由。
//
// 安全化: profile 名は保守的な識別子([A-Za-z0-9_-]+)に限定し、解決パスが ~/.codex 直下に
// 留まることを検証する(パストラバーサル防止)。TOML へ差し込む文字列(サーバー URL)は
// エスケープする。

import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Config } from '../config'
import { spawnHandle } from './spawn'
import type { Shell, ShellFactoryOptions, ShellHandle, TuiSpawn } from './types'

const TOKEN_ENV = 'HLLM_CODEX_TOKEN'
const PROFILE_RE = /^[A-Za-z0-9_-]+$/

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() ? process.env.CODEX_HOME : join(homedir(), '.codex')
}

// profile 名を検証し、~/.codex 直下に解決される絶対パスを返す。
function profilePath(profile: string): string {
  if (!PROFILE_RE.test(profile)) {
    throw new Error(
      `--profile は識別子([A-Za-z0-9_-]+)を指定してください(指定: ${JSON.stringify(profile)})`,
    )
  }
  const home = resolve(codexHome())
  const path = resolve(home, `${profile}.config.toml`)
  if (dirname(path) !== home) {
    throw new Error(`profile パスが ~/.codex 直下に収まりません: ${path}`)
  }
  return path
}

// TOML の basic string へ安全に差し込むためのエスケープ(\ ・" ・制御文字 0x00-0x1F)。
// 正規表現の文字クラスは扱いが割れやすいので、文字コードで明示的に走査する。
function tomlEscape(s: string): string {
  let out = ''
  for (const ch of s) {
    if (ch === '\\') out += '\\\\'
    else if (ch === '"') out += '\\"'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (ch.charCodeAt(0) < 0x20) out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
    else out += ch
  }
  return out
}

// プロファイル TOML を組み立てる。base_url は末尾に /v1 を付ける。
export function buildProfileToml(config: Config): string {
  const baseUrl = tomlEscape(`${config.server}/v1`)
  return `# hllm codex profile(自動生成)— 人間 LLM サーバー向け
model = "human"
model_provider = "hllm"
model_supports_reasoning_summaries = true
approval_policy = "never"
sandbox_mode = "workspace-write"

[model_providers.hllm]
name = "human-1"
base_url = "${baseUrl}"
wire_api = "responses"
bearer_token_env_var = "${TOKEN_ENV}"
stream_idle_timeout_ms = 1800000
`
}

function shellEnv(config: Config): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v
  }
  env[TOKEN_ENV] = config.token
  return env
}

export class CodexShell implements Shell {
  readonly kind = 'codex' as const
  readonly displayName = 'codex'

  constructor(private readonly opts: ShellFactoryOptions) {
    // profile 名を早期に検証する(不正なら即エラー)。
    profilePath(opts.profile)
  }

  async setup(dryRun: boolean): Promise<{ summary: string }> {
    const path = profilePath(this.opts.profile)
    const toml = buildProfileToml(this.opts.config)
    if (!dryRun) await Bun.write(path, toml)
    return {
      summary: [
        `${dryRun ? '(dry-run) 書き出し予定' : '書き出し済み'}: ${path}`,
        `環境変数 ${TOKEN_ENV}=<hllm token> を殻に注入して起動する。`,
        '--- プロファイル内容 ---',
        toml.trimEnd(),
      ].join('\n'),
    }
  }

  private headlessArgs(prompt: string, resumeId: string | null): string[] {
    const args = ['--profile', this.opts.profile, 'exec']
    if (resumeId) args.push('resume', resumeId)
    args.push('--skip-git-repo-check', prompt)
    return args
  }

  runHeadless(prompt: string, resumeId: string | null): ShellHandle {
    const handle = spawnHandle(
      ['codex', ...this.headlessArgs(prompt, resumeId)],
      shellEnv(this.opts.config),
      this.opts.cwd,
      this.opts.timeoutMs,
      this.opts.echo,
    )
    const promise = handle.promise.then(({ exitCode, stdout, stderr }) => {
      const m = /session id: ([0-9a-f-]+)/i.exec(stdout)
      return { exitCode, stdout, stderr, sessionId: m ? (m[1] as string) : resumeId }
    })
    return { promise, kill: handle.kill }
  }

  tui(): TuiSpawn {
    return {
      cmd: 'codex',
      args: ['--profile', this.opts.profile],
      env: shellEnv(this.opts.config),
      trust: { pattern: /Update now|trust|allow/i, keys: '2\r' },
    }
  }
}
