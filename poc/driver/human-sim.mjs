// 人間シミュレータ: humanllm の WebSocket に接続し、「考えてから」自動回答する(E2E検証用)
// 使い方: node human-sim.mjs [回答テキスト]
import WebSocket from 'ws'

const answer = process.argv[2] ?? 'こんにちは、私は人間LLMシミュレータです。'
const ws = new WebSocket('ws://localhost:3000/ws')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

ws.on('open', () => console.log('[sim] connected'))
ws.on('message', async (raw) => {
  const msg = JSON.parse(raw.toString())
  if (msg.type !== 'request') return
  const lastUser = [...msg.messages].reverse().find((m) => m.role === 'user')
  console.log(`[sim] request ${msg.requestId}: ${(lastUser?.content ?? '').slice(0, 200)}`)
  console.log(`[sim] tools: ${msg.tools?.map((t) => t.name).join(', ') ?? '(none)'}`)

  // 思考 → 途中経過 → 最終回答、の順で人間らしく振る舞う
  await sleep(800)
  ws.send(JSON.stringify({ type: 'reasoning', requestId: msg.requestId, content: '**うーん、難問に遭遇**\n\nこれはなかなか難しい問いだ…。\n' }))
  console.log('[sim] sent reasoning 1')
  await sleep(800)
  ws.send(JSON.stringify({ type: 'reasoning', requestId: msg.requestId, content: '落ち着いて考えれば答えは自明では?よし、方針は決まった。\n' }))
  console.log('[sim] sent reasoning 2')
  await sleep(800)
  ws.send(JSON.stringify({ type: 'delta', requestId: msg.requestId, content: 'では回答します。\n' }))
  console.log('[sim] sent delta')
  await sleep(800)
  ws.send(JSON.stringify({ type: 'response', requestId: msg.requestId, content: answer }))
  console.log(`[sim] answered: ${answer}`)
})
ws.on('error', (e) => console.error('[sim] error', e.message))
