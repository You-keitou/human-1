// CLI テスト共通ヘルパ。
// - runCli: `bun src/index.ts <args>` を子プロセスで実行し exit code / stdout / stderr を収集する。
// - makeTempDir / rmTempDir: 本物の ~/.config・~/.codex を汚さないための一時ディレクトリ。
// - writeFakes: PATH 先頭に置くフェイク実行ファイル(トレーナー役 claude・殻役 codex)を書き出す。
//   フェイクはリポジトリ外の一時 dir に生成するので biome / tsc の対象にならない。

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 指定ポートが LISTEN 中でない(接続拒否される)なら true。
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const sock = connect({ port, host: '127.0.0.1' })
    const done = (free: boolean) => {
      sock.removeAllListeners()
      sock.destroy()
      res(free)
    }
    sock.once('connect', () => done(false)) // 接続できた = まだ使用中
    sock.once('error', () => done(true)) // 拒否 = 解放済み
  })
}

// wrangler dev の停止直後は workerd の孫プロセスが数秒ポートを保持しうる。
// 反復実行(×3)で同じ固定ポートを再利用しても衝突しないよう、解放を待ってから進む。
// best-effort: timeout しても例外は投げない(スイートをハングさせない)。
export async function waitPortFree(port: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return
    await sleep(200)
  }
}

export const cliEntry = resolve(import.meta.dir, '..', '..', 'src', 'index.ts')

export type CliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

// 子プロセスで CLI を実行する。env は既存 process.env に上書きを重ねる。
// 一時 dir を汚さないため XDG_CONFIG_HOME 等は呼び出し側が overrides で指定する。
export async function runCli(
  args: string[],
  overrides: Record<string, string> = {},
): Promise<CliResult> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  Object.assign(env, overrides)
  const proc = Bun.spawn(['bun', cliEntry, ...args], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `hllm-${prefix}-`))
}

export function rmTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // 既に消えていれば無視
  }
}

export function readJsonl(path: string): Record<string, unknown>[] {
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

// フェイク claude(トレーナー役)。
//   - `--system-prompt` 付きで呼ばれる(trainer.ts)。プロンプトに「エポック」を含めば採点、
//     含まなければ kickoff とみなし出題文を返す。
//   - 毎回新しい session_id(sess-N)を返す(--resume fork 追跡の検証用)。
//   - 受信した argv / --resume / 返した session_id を trainer-log.jsonl に追記する。
//   - 受け取った env のうち機微キー(ANTHROPIC_* 等)の有無を trainer-env.json に書く
//     (トレーナー環境隔離の検証用)。
//   - HLLM_FAKE_CLAUDE_FAIL_ON_EVAL=1 のとき、採点(エポック)呼び出しで exit 1 する
//     (トレーナー例外 → active rollout の best-effort /end の検証用)。
//   - stdout には JSON のみを出す(trainer.ts が JSON.parse する)。ログは fs で別ファイルへ。
const FAKE_CLAUDE = `#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const argv = Bun.argv.slice(2)
const dir = process.env.HLLM_FAKE_DIR
const ri = argv.indexOf('--resume')
const resume = ri >= 0 ? argv[ri + 1] : null
const prompt = argv[argv.length - 1] ?? ''
const SENSITIVE = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
]
const envSeen = {}
for (const k of SENSITIVE) envSeen[k] = k in process.env ? process.env[k] : null
writeFileSync(dir + '/trainer-env.json', JSON.stringify(envSeen))
const statePath = dir + '/trainer-state.json'
let state = { calls: 0, evals: 0 }
try {
  state = JSON.parse(readFileSync(statePath, 'utf8'))
} catch {}
state.calls++
const isEval = /エポック/.test(prompt)
const isTimeout = /タイムアウト/.test(prompt)
if (isEval && process.env.HLLM_FAKE_CLAUDE_FAIL_ON_EVAL === '1') {
  writeFileSync(statePath, JSON.stringify(state))
  appendFileSync(
    dir + '/trainer-log.jsonl',
    JSON.stringify({ role: 'trainer', argv, resume, prompt, isEval, isTimeout, failed: true }) + '\\n',
  )
  process.stderr.write('fake claude forced eval failure\\n')
  process.exit(1)
}
let result
if (isEval) {
  state.evals++
  const scores = [7.5, 8.0, 8.5, 9.0]
  const s = scores[state.evals - 1] ?? 9.5
  result = '講評します。よくなっています。[SCORE: ' + s + '/10]'
} else {
  result = 'rubric: 明確さ4/正確さ3/簡潔さ3(計10)。タスク1: フィボナッチ関数を書け。'
}
const sessionId = 'sess-' + state.calls
writeFileSync(statePath, JSON.stringify(state))
appendFileSync(
  dir + '/trainer-log.jsonl',
  JSON.stringify({ role: 'trainer', argv, resume, prompt, returnedSessionId: sessionId, isEval, isTimeout }) + '\\n',
)
process.stdout.write(JSON.stringify({ result, session_id: sessionId }) + '\\n')
`

// フェイク codex(殻役)。挙動は env HLLM_FAKE_CODEX_MODE で切替える:
//   - 'normal'(既定): /v1/responses に POST(人間に出題)→ "session id: <uuid>" を出して exit 0。
//   - 'fail'       : POST せず即 exit 3(殻の子異常終了 → タイムアウト待たず即失敗の検証)。
//   - 'slow'       : POST(人間が回答)後 HLLM_FAKE_CODEX_DELAY_MS(既定 2500)スリープしてから
//                    session を出し exit 0(次 rollout 前の子完了 await = resume 書き戻しの検証)。
//   - 'answerfail' : POST(人間が回答)後、session を出さず exit 3(回答受信後の殻非ゼロ終了 →
//                    race の勝敗に関係なく失敗になる検証。要件1)。
//   いずれも argv / resume / 出した session を codex-log.jsonl に追記する。
const FAKE_CODEX = `#!/usr/bin/env bun
import { appendFileSync } from 'node:fs'
const argv = Bun.argv.slice(2)
const dir = process.env.HLLM_FAKE_DIR
const mode = process.env.HLLM_FAKE_CODEX_MODE ?? 'normal'
const delayMs = Number(process.env.HLLM_FAKE_CODEX_DELAY_MS ?? '2500')
const ri = argv.indexOf('resume')
const resume = ri >= 0 ? argv[ri + 1] : null
const prompt = argv[argv.length - 1] ?? ''
const server = process.env.HLLM_SERVER
const token = process.env.HLLM_TOKEN
const sessionId = crypto.randomUUID()
appendFileSync(
  dir + '/codex-log.jsonl',
  JSON.stringify({ role: 'codex', argv, resume, prompt, returnedSessionId: sessionId, mode }) + '\\n',
)
if (mode === 'fail') {
  process.stderr.write('fake codex forced failure\\n')
  process.exit(3)
}
try {
  const res = await fetch(server + '/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ model: 'human', input: prompt, stream: false }),
  })
  await res.text()
} catch {}
if (mode === 'answerfail') {
  process.stderr.write('fake codex failure after answer\\n')
  process.exit(3)
}
if (mode === 'slow') await new Promise((r) => setTimeout(r, delayMs))
process.stdout.write('session id: ' + sessionId + '\\n')
`

// フェイク実行ファイル一式を dir に書き出し、PATH 先頭に足すべきその dir を返す。
export function writeFakes(dir: string): { fakeClaude: string; fakeCodex: string } {
  const fakeClaude = join(dir, 'claude')
  const fakeCodex = join(dir, 'codex')
  writeFileSync(fakeClaude, FAKE_CLAUDE)
  writeFileSync(fakeCodex, FAKE_CODEX)
  chmodSync(fakeClaude, 0o755)
  chmodSync(fakeCodex, 0o755)
  return { fakeClaude, fakeCodex }
}
