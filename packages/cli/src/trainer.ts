// トレーナー AI = `claude -p`(サブスク認証・API キー不要)のラッパ。
// PoC 知見: `claude -p --resume` は毎回新 session_id に fork するので、返却された
// 最新 session_id を追跡して次の --resume に渡す。トレーナーは本物の Claude API を
// 使うため、殻向けの ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN は env から除去する。

export type TrainerOptions = {
  systemPrompt: string
  model?: string
  // claude 1 発あたりのタイムアウト(ms)。
  timeoutMs?: number
}

type ClaudeJson = {
  result?: unknown
  session_id?: unknown
}

// トレーナー子プロセスから除去する API ルーティング/資格情報系の環境変数。
// サブスク認証が API キー課金に化けるのを防ぐ(CLAUDE.md「API キー不要」)。
// 殻向けの上書き(ANTHROPIC_BASE_URL 等)や Bedrock/Vertex ルーティングを fail-closed で落とす。
const TRAINER_STRIP_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
]

export class ClaudeTrainer {
  private sessionId: string | null = null

  constructor(private readonly opts: TrainerOptions) {}

  currentSessionId(): string | null {
    return this.sessionId
  }

  async ask(prompt: string): Promise<string> {
    const args = ['-p', '--output-format', 'json', '--system-prompt', this.opts.systemPrompt]
    if (this.opts.model) args.push('--model', this.opts.model)
    if (this.sessionId) args.push('--resume', this.sessionId)
    args.push(prompt)

    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v
    }
    for (const k of TRAINER_STRIP_ENV) delete env[k]

    const proc = Bun.spawn(['claude', ...args], {
      env,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: this.opts.timeoutMs ?? 300_000,
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (exitCode !== 0) {
      throw new Error(`claude -p が異常終了しました(exit=${exitCode}): ${stderr.slice(0, 400)}`)
    }
    let parsed: ClaudeJson
    try {
      parsed = JSON.parse(stdout) as ClaudeJson
    } catch (e) {
      throw new Error(
        `claude -p の JSON 出力を解析できません: ${(e as Error).message}\n${stdout.slice(0, 400)}`,
      )
    }
    // fail-closed: 期待型でなければ throw する。特に session_id が壊れていたら古い ID を
    // 黙って使い続けず(誤った resume・履歴汚染の防止)、ここで訓練を止める。
    if (typeof parsed.result !== 'string') {
      throw new Error('claude -p の応答に文字列 result がありません(fail-closed)')
    }
    if (typeof parsed.session_id !== 'string' || parsed.session_id.length === 0) {
      throw new Error(
        'claude -p の応答に session_id がありません(fail-closed: 古い ID を再利用しない)',
      )
    }
    this.sessionId = parsed.session_id
    return parsed.result.trim()
  }
}
