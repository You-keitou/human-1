#!/usr/bin/env node
// theater-claude.mjs — 逆転劇場 Claude Code 版: LLM が Claude Code を操作して人間LLMに出題する
//
//   出題者AI (claude -p, 本物のAPI) → Claude Code TUI (node-pty, ANTHROPIC_BASE_URL=humanllm)
//     → humanllm サーバー → React UI → 人間が回答(thinking も打てる)
//
// 人間の回答は humanllm サーバーの WebSocket が配信する 'answered' イベントで検出する。
// (humanllm に向けた Claude Code はセッション JSONL を書かないため、JSONL tail は使えない)
//
// 使い方:
//   node theater-claude.mjs [お題のテーマ]
//   環境変数: THEATER_TURNS=3, THEATER_MODEL (出題者AIのモデル)
import pty from 'node-pty'
import WebSocket from 'ws'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLAYGROUND = path.resolve(__dirname, '../playground')
const TURNS = Number(process.env.THEATER_TURNS ?? 3)
const THEME = process.argv[2] ?? '自由(プログラミング・言葉遊び・雑学など何でも)'
const MODEL = process.env.THEATER_MODEL
const LOG_PATH = path.join(__dirname, 'theater-claude-log.md')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 出題者AI (claude -p, 本物の API を使う) ----------
let llmSessionId = null
function askLLM(prompt) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json']
    if (MODEL) args.push('--model', MODEL)
    if (llmSessionId) args.push('--resume', llmSessionId)
    args.push(prompt)
    // 出題者は本物の Claude API を使う(humanllm に向けない)
    const env = { ...process.env }
    delete env.ANTHROPIC_BASE_URL
    delete env.ANTHROPIC_AUTH_TOKEN
    execFile('claude', args, { cwd: __dirname, env, maxBuffer: 10 * 1024 * 1024, timeout: 180_000 }, (err, stdout) => {
      if (err) return reject(err)
      try {
        const res = JSON.parse(stdout)
        llmSessionId = res.session_id ?? llmSessionId
        resolve(String(res.result ?? '').trim())
      } catch (e) {
        reject(new Error(`claude -p の出力を解析できません: ${e.message}\n${stdout.slice(0, 500)}`))
      }
    })
  })
}

// ---------- humanllm サーバーのイベントを監視してセッションログを組み立てる ----------
// 逆転構成では出題者AI(人間役)も、普段の人間がTUIで見るのと同じ全て
// (思考・ツール実行・ツール結果・回答)を見られる必要がある。
const turnEvents = []
let answeredCount = 0
const observer = new WebSocket('ws://localhost:3000/ws')
observer.on('message', (raw) => {
  try {
    const msg = JSON.parse(raw.toString())
    if (msg.type === 'thought') {
      turnEvents.push(`[思考] ${msg.content.trim()}`)
    } else if (msg.type === 'tool_called') {
      const item = msg.item
      const desc = item.type === 'function_call'
        ? `${item.name} ${item.arguments}`
        : item.command.join(' ')
      turnEvents.push(`[ツール実行] ${desc}`)
    } else if (msg.type === 'request') {
      // ツール実行後の再リクエストには実行結果が含まれる
      const last = msg.messages[msg.messages.length - 1]
      if (last?.role === 'user' && /^\[(tool_result|function_call_output|local_shell_call_output)\]/.test(last.content)) {
        turnEvents.push(`[ツール結果] ${last.content.replace(/^\[[^\]]+\]\n?/, '').slice(0, 600).trim()}`)
      }
    } else if (msg.type === 'answered') {
      turnEvents.push(`[回答] ${msg.content.trim()}`)
      answeredCount++
    }
  } catch { /* skip */ }
})
observer.on('error', (e) => console.error(`[observer] ${e.message} — humanllm サーバーは起動していますか?`))

// ---------- メイン ----------
const log = []
function record(speaker, text) {
  log.push(`## ${speaker}\n\n${text}\n`)
  fs.writeFileSync(LOG_PATH, `# 逆転劇場ログ (Claude Code 版)\n\n${log.join('\n')}`)
}

console.log('🎭 逆転劇場 (Claude Code 版) を開演します')
console.log(`   テーマ: ${THEME} / ターン数: ${TURNS}`)
console.log('   回答者(あなた)は http://localhost:5174 を開いてください')
console.log('   まもなく Claude Code TUI が起動し、出題者AIが操作を始めます...\n')
await sleep(1500)

const ptyp = pty.spawn('claude', ['--model', 'human'], {
  name: 'xterm-256color',
  cols: process.stdout.columns || 120,
  rows: process.stdout.rows || 36,
  cwd: PLAYGROUND,
  env: {
    ...process.env,
    ANTHROPIC_BASE_URL: 'http://localhost:3000',
    ANTHROPIC_AUTH_TOKEN: 'dummy',
  },
})

let exited = false
let sawOutput = false
let lastDataAt = 0
let screenBuf = ''
ptyp.onData((d) => {
  sawOutput = true
  lastDataAt = Date.now()
  screenBuf = (screenBuf + d).slice(-8000)
  process.stdout.write(d)
})
ptyp.onExit(({ exitCode }) => { exited = true; finish(exitCode) })

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', (d) => ptyp.write(d.toString('utf8')))
  process.stdout.on('resize', () => ptyp.resize(process.stdout.columns, process.stdout.rows))
}

function finish(code) {
  if (process.stdin.isTTY) process.stdin.setRawMode(false)
  process.stdin.pause()
  observer.close()
  console.log(`\n🎭 閉幕(claude exit=${code})。対話ログ: ${LOG_PATH}`)
  process.exit(0)
}

// 信頼ダイアログ等を自動で受諾しつつ、描画が落ち着くまで待つ
async function waitTuiReady(maxMs = 30_000) {
  const begin = Date.now()
  while (Date.now() - begin < maxMs) {
    if (exited) throw new Error('claude が起動直後に終了しました')
    if (/trust the files|Do you trust/i.test(screenBuf)) {
      screenBuf = ''
      await sleep(300)
      ptyp.write('\r') // 既定の "Yes, proceed" を選択
      await sleep(1000)
      continue
    }
    if (sawOutput && Date.now() - begin > 4000 && Date.now() - lastDataAt > 2000) return
    await sleep(300)
  }
}

async function inject(text) {
  const line = text.replace(/\s+/g, ' ').trim()
  ptyp.write(line)
  await sleep(600)
  ptyp.write('\r')
}

// 人間の最終回答(answered)が出るまで待ち、そのターンの完全なセッションログを返す
async function waitTurnLog() {
  const before = answeredCount
  for (;;) {
    if (exited) throw new Error('claude が終了しました')
    if (answeredCount > before) {
      await sleep(300) // 直後のイベントの取りこぼし防止
      const transcript = turnEvents.join('\n')
      turnEvents.length = 0
      return transcript
    }
    await sleep(400)
  }
}

try {
  await waitTuiReady()

  let prompt =
    `あなたは「出題者AI」です。これから相手の「人間LLM」(人間がLLMのふりをして回答する遅くて気まぐれな言語モデル)と対話します。` +
    `毎ターン、あなたには相手のセッションログ全体(思考・ツール実行・ツール結果・回答)が見えます。普段のLLMに全履歴が送られるのと同じです。` +
    `まず、テーマ「${THEME}」で面白いお題や質問を1つ出してください。` +
    `出力はそのまま相手に送信されるので、お題の文のみを1行・120文字以内で出力。前置き・引用符・改行は禁止。`

  for (let turn = 1; turn <= TURNS; turn++) {
    const question = await askLLM(prompt)
    record(`🤖 出題者AI (turn ${turn})`, question)
    turnEvents.length = 0
    await inject(question)
    const transcript = await waitTurnLog()
    record(`🧑 人間LLM (turn ${turn})`, transcript)
    prompt =
      turn < TURNS
        ? `人間LLMのセッションログ:\n${transcript}\n---\nこのターンへの短い講評(思考過程やツールの使い方に触れてもよい)に続けて、次のお題を出してください。` +
          `出力はそのまま送信されるので送信文のみを1行・160文字以内で。改行禁止。`
        : `人間LLMのセッションログ:\n${transcript}\n---\nこれで最終ターンです。全ターンの思考過程・ツール使い・回答を振り返り、人間LLMへの感謝と総評を1行・160文字以内で。` +
          `出力はそのまま送信されるので送信文のみ。改行禁止。`
  }

  const finale = await askLLM(prompt)
  record('🤖 出題者AI (総評)', finale)
  await inject(`【総評・回答は不要です】${finale}`)
  fs.appendFileSync(LOG_PATH, `\n---\n劇場は開いたままです。Claude Code を終了(Ctrl+C ×2)すると閉幕します。\n`)
} catch (e) {
  if (!exited) {
    fs.appendFileSync(LOG_PATH, `\n---\nエラー: ${e.message}\n`)
    ptyp.kill()
  }
}
