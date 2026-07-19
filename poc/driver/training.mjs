#!/usr/bin/env node
// training.mjs — 人間LLM事後学習ループ: トレーナーAIが開発中のLLM(人間)を訓練する
//
//   トレーナーAI (claude -p --system-prompt / codex exec)
//     → TUI (claude または codex, node-pty) → humanllm サーバー → React UI → 人間(開発中のLLM)
//
// 訓練 loop:
//   1. rubric(評価メトリクス)定義 → 2. タスク出題 → 3. rollout(思考+tool+回答)
//   → 4. process 評価・採点 → 5. feedback+教師データ → 6. 類似タスクで再評価(学習曲線)
//
// 使い方:
//   node training.mjs [訓練ドメイン]
//   環境変数:
//     TRAIN_EPOCHS=3            エポック数
//     MEDIUM=claude|codex       人間が入る殻(デフォルト claude)
//     TRAINER=claude|codex      トレーナーAI(デフォルト claude)
//     TRAINER_MODEL=...         トレーナーのモデル(claude のみ有効)
import pty from 'node-pty'
import WebSocket from 'ws'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLAYGROUND = path.resolve(__dirname, '../playground')
const EPOCHS = Number(process.env.TRAIN_EPOCHS ?? 3)
const MEDIUM = process.env.MEDIUM ?? 'claude'
const TRAINER = process.env.TRAINER ?? 'claude'
const TRAINER_MODEL = process.env.TRAINER_MODEL
const DOMAIN = process.argv[2] ?? 'プログラミングとシェル操作の基礎'
const LOG_PATH = path.join(__dirname, 'training-log.md')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- トレーナーAI の役割定義 ----------
const SYSTEM_PROMPT =
  `あなたはLLMの事後学習(fine-tuning・強化学習)を担当するエンジニアです。` +
  `対話対象は現在開発中のLLM「human-1」——遅くて気まぐれだが、その場でパラメータを更新できる貴重なオンライン学習器です。\n` +
  `訓練ドメイン: ${DOMAIN}\n` +
  `訓練手順:\n` +
  `1. 最初に rubric(評価メトリクス3つ程度と配点、合計10点)を定義し学習者に開示し、最初のタスクを出す\n` +
  `2. 毎エポック、学習者の rollout(思考・ツール実行・ツール結果・最終出力の全軌跡)があなたに渡される\n` +
  `3. 軌跡の各ステップを rubric で process 評価し、総合スコアを出す\n` +
  `4. ステップ単位の feedback と、理想の軌跡(教師データ)を簡潔に示す\n` +
  `5. 次のタスクは類似タスクにして再評価し、スコア差(学習曲線)に言及する\n` +
  `6. rubric の字面だけ稼ぐ reward hacking を検出したら指摘し、rubric を改訂する\n` +
  `7. 時々過去の類似タスクを混ぜて忘却(catastrophic forgetting)を検査する\n` +
  `出力の制約: あなたの出力はそのまま学習者に送信される。採点時は必ず [SCORE: x.x/10] タグを含める(ドライバーが学習曲線を記録する)。` +
  `改行を使わず1メッセージにまとめ、500文字以内。前置きや引用符は禁止。`

// ---------- トレーナー実装(claude / codex) ----------
let claudeSessionId = null
function trainerClaude(prompt) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json', '--system-prompt', SYSTEM_PROMPT]
    if (TRAINER_MODEL) args.push('--model', TRAINER_MODEL)
    if (claudeSessionId) args.push('--resume', claudeSessionId)
    args.push(prompt)
    const env = { ...process.env }
    delete env.ANTHROPIC_BASE_URL
    delete env.ANTHROPIC_AUTH_TOKEN
    execFile('claude', args, { cwd: __dirname, env, maxBuffer: 10 * 1024 * 1024, timeout: 300_000 }, (err, stdout) => {
      if (err) return reject(err)
      try {
        const res = JSON.parse(stdout)
        claudeSessionId = res.session_id ?? claudeSessionId
        resolve(String(res.result ?? '').trim())
      } catch (e) {
        reject(new Error(`claude -p の出力を解析できません: ${e.message}\n${stdout.slice(0, 500)}`))
      }
    })
  })
}

let codexSessionId = null
function trainerCodex(prompt) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(__dirname, '.trainer-out.txt')
    const fullPrompt = codexSessionId ? prompt : `${SYSTEM_PROMPT}\n\n${prompt}`
    const args = codexSessionId
      ? ['exec', 'resume', codexSessionId, '--skip-git-repo-check', '-o', outFile, fullPrompt]
      : ['exec', '--skip-git-repo-check', '-o', outFile, fullPrompt]
    execFile('codex', args, { cwd: __dirname, maxBuffer: 10 * 1024 * 1024, timeout: 300_000 }, (err, stdout) => {
      if (err) return reject(err)
      const m = /session id: ([0-9a-f-]+)/.exec(stdout)
      if (m) codexSessionId = m[1]
      try {
        resolve(fs.readFileSync(outFile, 'utf8').trim())
      } catch (e) {
        reject(new Error(`codex exec の出力ファイルを読めません: ${e.message}`))
      }
    })
  })
}

const askTrainer = TRAINER === 'codex' ? trainerCodex : trainerClaude

// ---------- 人間が入る殻(medium)の定義 ----------
const MEDIA = {
  claude: {
    cmd: 'claude',
    args: ['--model', 'human'],
    env: { ANTHROPIC_BASE_URL: 'http://localhost:3000', ANTHROPIC_AUTH_TOKEN: 'dummy' },
    dialog: { pattern: /trust the files|Do you trust/i, keys: '\r' },
    name: 'Claude Code',
  },
  codex: {
    cmd: 'codex',
    args: ['--profile', 'humanllm'],
    env: { HUMANLLM_API_KEY: 'dummy' },
    dialog: { pattern: /Update now/, keys: '2\r' },
    name: 'codex',
  },
}
const medium = MEDIA[MEDIUM]
if (!medium) { console.error(`MEDIUM は claude か codex を指定してください: ${MEDIUM}`); process.exit(1) }

// ---------- humanllm サーバーのイベントを監視してセッションログを組み立てる ----------
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
      const last = msg.messages[msg.messages.length - 1]
      if (last?.role === 'user' && /^\[(tool_result|function_call_output|local_shell_call_output)\]/.test(last.content)) {
        turnEvents.push(`[ツール結果] ${last.content.replace(/^\[[^\]]+\]\n?/, '').slice(0, 600).trim()}`)
      }
    } else if (msg.type === 'answered') {
      turnEvents.push(`[最終出力] ${msg.content.trim()}`)
      answeredCount++
    }
  } catch { /* skip */ }
})
observer.on('error', (e) => console.error(`[observer] ${e.message} — humanllm サーバーは起動していますか?`))

// ---------- メイン ----------
const log = []
const scores = []
function record(speaker, text) {
  log.push(`## ${speaker}\n\n${text}\n`)
  const curve = scores.length ? `\n**学習曲線**: ${scores.join(' → ')}\n` : ''
  fs.writeFileSync(LOG_PATH, `# 人間LLM 事後学習ログ\n\nドメイン: ${DOMAIN} / 殻: ${medium.name} / トレーナー: ${TRAINER}\n${curve}\n${log.join('\n')}`)
}

console.log('🏋️ 人間LLM 事後学習を開始します')
console.log(`   ドメイン: ${DOMAIN} / エポック数: ${EPOCHS} / 殻: ${medium.name} / トレーナー: ${TRAINER}`)
console.log('   学習者(あなた)は http://localhost:5174 を開いてください')
console.log(`   まもなく ${medium.name} TUI が起動し、トレーナーAIが訓練を始めます...\n`)
await sleep(1500)

const ptyp = pty.spawn(medium.cmd, medium.args, {
  name: 'xterm-256color',
  cols: process.stdout.columns || 120,
  rows: process.stdout.rows || 36,
  cwd: PLAYGROUND,
  env: { ...process.env, ...medium.env },
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
  console.log(`\n🏋️ 訓練終了(${medium.name} exit=${code})。ログ: ${LOG_PATH}`)
  if (scores.length) console.log(`   学習曲線: ${scores.join(' → ')}`)
  process.exit(0)
}

async function waitTuiReady(maxMs = 30_000) {
  const begin = Date.now()
  while (Date.now() - begin < maxMs) {
    if (exited) throw new Error(`${medium.name} が起動直後に終了しました`)
    if (medium.dialog.pattern.test(screenBuf)) {
      screenBuf = ''
      await sleep(300)
      ptyp.write(medium.dialog.keys)
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

async function waitTurnLog() {
  const before = answeredCount
  for (;;) {
    if (exited) throw new Error(`${medium.name} が終了しました`)
    if (answeredCount > before) {
      await sleep(300)
      const transcript = turnEvents.join('\n')
      turnEvents.length = 0
      return transcript
    }
    await sleep(400)
  }
}

function parseScore(text) {
  const m = /\[SCORE:\s*([\d.]+)/i.exec(text)
  return m ? Number(m[1]) : null
}

try {
  await waitTuiReady()

  // エポック0: rubric 定義 + 最初のタスク
  let trainerOut = await askTrainer(
    `訓練を開始します。まず rubric(評価メトリクスと配点)を定義して学習者に開示し、最初のタスクを出してください。`
  )
  record('🧑‍🔬 トレーナー (rubric定義+タスク1)', trainerOut)
  turnEvents.length = 0
  await inject(trainerOut)

  for (let epoch = 1; epoch <= EPOCHS; epoch++) {
    const transcript = await waitTurnLog()
    record(`🤖 human-1 (rollout ${epoch})`, transcript)
    const isLast = epoch === EPOCHS
    trainerOut = await askTrainer(
      `エポック${epoch} の rollout:\n${transcript}\n---\n` +
      (isLast
        ? `これで最終エポックです。採点([SCORE: x.x/10] 必須)と feedback、全エポックの学習曲線を踏まえた総評を出してください。次のタスクは不要です。`
        : `採点([SCORE: x.x/10] 必須)、ステップ単位の feedback と教師データ、そして次のタスク(類似タスクで再評価)を出してください。`)
    )
    const s = parseScore(trainerOut)
    if (s !== null) scores.push(s)
    record(`🧑‍🔬 トレーナー (エポック${epoch} 評価${isLast ? '+総評' : '+タスク' + (epoch + 1)})`, trainerOut)
    turnEvents.length = 0
    await inject(isLast ? `【訓練終了・回答不要】${trainerOut}` : trainerOut)
  }

  fs.appendFileSync(LOG_PATH, `\n---\n訓練セッションは開いたままです。${medium.name} を終了(Ctrl+C ×2)すると閉じます。\n`)
} catch (e) {
  if (!exited) {
    fs.appendFileSync(LOG_PATH, `\n---\nエラー: ${e.message}\n`)
    ptyp.kill()
  }
}
