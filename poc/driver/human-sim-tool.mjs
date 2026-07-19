// ツール実行版シミュレータ: 1回目のリクエストで思考+シェルツールを発行し、
// 2回目(実行結果つき)のリクエストで最終回答する(E2E検証用)
// ツール名はリクエストの tools 一覧から自動判別(Claude Code: Bash / codex: exec_command)
import WebSocket from 'ws'

const ws = new WebSocket('ws://localhost:3000/ws')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let phase = 0

ws.on('open', () => console.log('[sim-tool] connected'))
ws.on('message', async (raw) => {
  const msg = JSON.parse(raw.toString())
  if (msg.type !== 'request') return
  phase++
  const last = msg.messages[msg.messages.length - 1]
  console.log(`[sim-tool] request#${phase}: ${(last?.content ?? '').slice(0, 120)}`)

  if (phase === 1) {
    await sleep(500)
    ws.send(JSON.stringify({ type: 'reasoning', requestId: msg.requestId, content: '手を動かして確かめよう。ツールを使うぞ。\n' }))
    await sleep(500)
    const names = msg.tools?.map((t) => t.name) ?? []
    const cmd = 'echo "proof-by-human-$(date +%s)" > proof.txt && cat proof.txt'
    const [name, args] = names.includes('Bash')
      ? ['Bash', { command: cmd }]
      : ['exec_command', { cmd }]
    ws.send(JSON.stringify({
      type: 'function_call',
      requestId: msg.requestId,
      callId: crypto.randomUUID(),
      name,
      arguments: JSON.stringify(args),
    }))
    console.log(`[sim-tool] sent ${name}`)
  } else {
    await sleep(500)
    ws.send(JSON.stringify({ type: 'reasoning', requestId: msg.requestId, content: '実行結果が届いた。これを踏まえて答えよう。\n' }))
    await sleep(500)
    ws.send(JSON.stringify({ type: 'response', requestId: msg.requestId, content: `コマンドを実行して確認しました。出力: ${(last?.content ?? '').split('\n').slice(-2).join(' ').slice(0, 120)}` }))
    console.log('[sim-tool] sent final response')
    setTimeout(() => process.exit(0), 1500)
  }
})
ws.on('error', (e) => console.error('[sim-tool] error', e.message))
