import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import type { IncomingMessage, ServerResponse } from 'http'
import { app } from './api/chat'
import { handleResponsesNode } from './api/responses-node'
import { handleMessagesNode } from './api/messages-node'
import { handleWebSocket } from './ws/handler'

const PORT = 3000

const server = serve({ fetch: app.fetch, port: PORT })

// /v1/responses は Hono のストリーミング層を経由せず
// 生の Node.js res.write() で SSE を処理する
const honoListeners = server.listeners('request').slice()
server.removeAllListeners('request')

server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
  console.log(`[http] ${req.method} ${req.url}`)
  if (req.url === '/v1/responses') {
    await handleResponsesNode(req, res)
    return
  }
  // Anthropic Messages API (Claude Code 用)。クエリ文字列 (?beta=true) 付きで呼ばれる
  const pathname = req.url?.split('?')[0]
  if (pathname === '/v1/messages' || pathname === '/v1/messages/count_tokens') {
    await handleMessagesNode(req, res)
    return
  }
  for (const listener of honoListeners) {
    (listener as (req: IncomingMessage, res: ServerResponse) => void)(req, res)
  }
})

const wss = new WebSocketServer({ noServer: true })

wss.on('connection', handleWebSocket)

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  } else {
    socket.destroy()
  }
})

console.log(`[server] listening on http://localhost:${PORT}`)
