// Claude Code を殻として使う。人間 LLM サーバーへは環境変数だけで向ける
// (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN)。プロファイル書き出しは不要。
//   ヘッドレス: claude -p --model human --output-format json [--resume <id>] <prompt>
//   TUI:       claude --model human

import type { Config } from '../config'
import { spawnHandle } from './spawn'
import type { Shell, ShellFactoryOptions, ShellHandle, TuiSpawn } from './types'

function shellEnv(config: Config): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v
  }
  env.ANTHROPIC_BASE_URL = config.server
  env.ANTHROPIC_AUTH_TOKEN = config.token
  // 本物の API キーが残っていると誤って本番へ向くので除去する。
  delete env.ANTHROPIC_API_KEY
  return env
}

export class ClaudeShell implements Shell {
  readonly kind = 'claude' as const
  readonly displayName = 'Claude Code'

  constructor(private readonly opts: ShellFactoryOptions) {}

  async setup(_dryRun: boolean): Promise<{ summary: string }> {
    const env = shellEnv(this.opts.config)
    return {
      summary: [
        'Claude Code は環境変数だけで人間 LLM サーバーへ向ける(プロファイル書き出し不要):',
        `  ANTHROPIC_BASE_URL=${env.ANTHROPIC_BASE_URL}`,
        '  ANTHROPIC_AUTH_TOKEN=<hllm token>',
        '  (ANTHROPIC_API_KEY は除去)',
      ].join('\n'),
    }
  }

  runHeadless(prompt: string, resumeId: string | null): ShellHandle {
    const args = ['-p', '--model', 'human', '--output-format', 'json']
    if (resumeId) args.push('--resume', resumeId)
    args.push(prompt)
    const handle = spawnHandle(
      ['claude', ...args],
      shellEnv(this.opts.config),
      this.opts.cwd,
      this.opts.timeoutMs,
      false,
    )
    const promise = handle.promise.then(({ exitCode, stdout, stderr }) => {
      let sessionId: string | null = resumeId
      try {
        const parsed = JSON.parse(stdout) as { session_id?: unknown }
        if (typeof parsed.session_id === 'string') sessionId = parsed.session_id
      } catch {
        // JSON でなければ sessionId は据え置き(回答検出は WS 側で行う)。
      }
      return { exitCode, stdout, stderr, sessionId }
    })
    return { promise, kill: handle.kill }
  }

  tui(): TuiSpawn {
    return {
      cmd: 'claude',
      args: ['--model', 'human'],
      env: shellEnv(this.opts.config),
      trust: { pattern: /trust the files|Do you trust/i, keys: '\r' },
    }
  }
}
