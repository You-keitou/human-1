// TUI で reasoning が表示されるか検証するプローブ
// codex TUI を PTY で起動 → 質問を注入 → 画面出力を全部記録して終了
import pty from 'node-pty'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLAYGROUND = path.resolve(__dirname, '../playground')
const OUT = path.join(__dirname, 'tui-probe.raw')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let buf = ''
const ptyp = pty.spawn('codex', ['--profile', 'humanllm'], {
  name: 'xterm-256color', cols: 110, rows: 40,
  cwd: PLAYGROUND,
  env: { ...process.env, HUMANLLM_API_KEY: 'dummy' },
})
ptyp.onData((d) => { buf += d })
ptyp.onExit(() => { fs.writeFileSync(OUT, buf); process.exit(0) })

await sleep(8000) // TUI 起動待ち
ptyp.write('パンはパンでも食べられないパンは?')
await sleep(600)
ptyp.write('\r')
await sleep(12000) // sim の思考(1.6s)+回答を待つ
fs.writeFileSync(OUT, buf)
ptyp.kill()
setTimeout(() => process.exit(0), 1000)
