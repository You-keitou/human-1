import type { IncomingMessage, ServerResponse } from 'http'
import type { ChatMessage, ToolCallItem, ToolInfo } from '../../shared/types'
import { addPending, rejectPending } from '../store/pendingRequests'
import { broadcast } from '../ws/clients'

// Anthropic Messages API (/v1/messages) 実装。
// Claude Code を ANTHROPIC_BASE_URL でこのサーバーに向けると、人間が Claude になれる。
// 人間は考えるのに時間がかかる。思考や途中経過を送るたびにタイマーは再武装される。
const TIMEOUT_MS = 30 * 60 * 1000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

type Block = Record<string, unknown>

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')
  return content
    .map((b: Block) => {
      if (typeof b === 'string') return b
      switch (b.type) {
        case 'text': return String(b.text ?? '')
        case 'thinking': return `[thinking]\n${String(b.thinking ?? '')}`
        case 'tool_use': return `[tool_use: ${String(b.name ?? '')}]\n${JSON.stringify(b.input ?? {})}`
        case 'tool_result': return `[tool_result]\n${contentToText(b.content)}`
        case 'image': return '[image]'
        default: return `[${String(b.type ?? 'unknown')}]`
      }
    })
    .filter((s) => s.length > 0)
    .join('\n')
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export async function handleMessagesNode(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  const raw = await readBody(req)

  // トークン数概算だけ返す補助エンドポイント
  if (req.url?.startsWith('/v1/messages/count_tokens')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS })
    res.end(JSON.stringify({ input_tokens: Math.max(1, Math.ceil(raw.length / 4)) }))
    return
  }

  const body = JSON.parse(raw) as {
    model?: string
    system?: unknown
    messages: Array<{ role: string; content: unknown }>
    tools?: Array<Record<string, unknown>>
    stream?: boolean
  }
  const { model = 'human', system, messages: inMessages, tools, stream = false } = body
  console.log(`[messages] model=${model} stream=${stream} tools=${tools?.map((t) => t.name).join(',') ?? 'none'}`)

  const toolInfos: ToolInfo[] = (tools ?? []).map((t) => {
    const name = String(t.name ?? 'unknown')
    const description = t.description as string | undefined
    const parameters = t.input_schema
    return { name, ...(description ? { description } : {}), ...(parameters ? { parameters } : {}) }
  })

  const messages: ChatMessage[] = []
  if (system) messages.push({ role: 'system', content: contentToText(system) })
  for (const m of inMessages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    messages.push({ role, content: contentToText(m.content) })
  }

  const requestId = crypto.randomUUID()
  const msgApiId = `msg_${requestId}`
  const createdAt = Math.floor(Date.now() / 1000)

  // Claude Code の裏方リクエスト(セッションタイトル生成・入力サジェスト)は
  // 人間を煩わせず、サーバーが即座に自動応答する
  const flat = messages.map((m) => m.content).join('\n')
  const isTitleGen = flat.includes('<session>') && /Write the title/i.test(flat)
  const isSuggestion = flat.includes('[SUGGESTION MODE')
  if (isTitleGen || isSuggestion) {
    const canned = isTitleGen ? '人間LLM劇場' : ' '
    console.log(`[messages] auto-answered background request (${isTitleGen ? 'title' : 'suggestion'})`)
    if (!stream) {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS })
      res.end(JSON.stringify({
        id: msgApiId, type: 'message', role: 'assistant', model,
        content: [{ type: 'text', text: canned }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      }))
      return
    }
    const socket = req.socket
    socket.setNoDelay(true)
    const headerLines = [
      'HTTP/1.1 200 OK', 'Content-Type: text/event-stream', 'Cache-Control: no-cache', 'Connection: keep-alive',
      ...Object.entries(CORS_HEADERS).map(([k, v]) => `${k}: ${v}`), '', '',
    ].join('\r\n')
    socket.write(headerLines)
    const sse = (event: string, data: object) => socket.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    sse('message_start', {
      type: 'message_start',
      message: { id: msgApiId, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
    })
    sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: canned } })
    sse('content_block_stop', { type: 'content_block_stop', index: 0 })
    sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } })
    sse('message_stop', { type: 'message_stop' })
    socket.end()
    return
  }

  const toolUseBlock = (item: ToolCallItem) => {
    if (item.type === 'function_call') {
      let input: unknown = {}
      try { input = JSON.parse(item.arguments) } catch { input = { raw: item.arguments } }
      return { type: 'tool_use', id: `toolu_${item.callId}`, name: item.name, input }
    }
    // local_shell_call は Claude Code には無いので Bash 相当として送る
    const script = item.command.length >= 3 ? item.command[2] : item.command.join(' ')
    return { type: 'tool_use', id: `toolu_${item.callId}`, name: 'Bash', input: { command: script } }
  }

  if (!stream) {
    type CompletionResult = { kind: 'text'; text: string } | { kind: 'tool'; item: ToolCallItem }
    const result = await new Promise<CompletionResult>((resolve, reject) => {
      addPending(
        requestId, messages, () => {},
        (text) => resolve({ kind: 'text', text }),
        reject,
        (item) => resolve({ kind: 'tool', item }),
      )
      broadcast({ type: 'request', requestId, messages, model, createdAt, tools: toolInfos })
      setTimeout(() => {
        const rejected = rejectPending(requestId, new Error('timeout'))
        if (rejected) broadcast({ type: 'timeout', requestId })
      }, TIMEOUT_MS)
    })

    const content = result.kind === 'text'
      ? [{ type: 'text', text: result.text }]
      : [toolUseBlock(result.item)]
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS })
    res.end(JSON.stringify({
      id: msgApiId, type: 'message', role: 'assistant', model,
      content,
      stop_reason: result.kind === 'tool' ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    }))
    return
  }

  // --- SSE streaming (Anthropic event format) ---
  const socket = req.socket
  if (!socket) { res.writeHead(500); res.end(); return }
  socket.setNoDelay(true)

  const headerLines = [
    'HTTP/1.1 200 OK',
    'Content-Type: text/event-stream',
    'Cache-Control: no-cache',
    'Connection: keep-alive',
    ...Object.entries(CORS_HEADERS).map(([k, v]) => `${k}: ${v}`),
    '',
    '',
  ].join('\r\n')
  socket.write(headerLines)

  const writeSSE = (event: string, data: object) => {
    socket.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  writeSSE('message_start', {
    type: 'message_start',
    message: {
      id: msgApiId, type: 'message', role: 'assistant', model,
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const armTimeout = () => {
    clearTimeout(timeoutHandle)
    timeoutHandle = setTimeout(() => {
      const rejected = rejectPending(requestId, new Error('timeout'))
      if (rejected) broadcast({ type: 'timeout', requestId })
    }, TIMEOUT_MS)
  }

  // ブロック状態管理: thinking(あれば index 0)→ text または tool_use
  let blockIndex = -1
  let thinkingOpen = false
  let textOpen = false

  const openThinking = () => {
    if (thinkingOpen || textOpen) return
    thinkingOpen = true
    blockIndex++
    writeSSE('content_block_start', {
      type: 'content_block_start', index: blockIndex,
      content_block: { type: 'thinking', thinking: '' },
    })
  }
  const closeThinking = () => {
    if (!thinkingOpen) return
    thinkingOpen = false
    // 署名は検証されないのでダミーを送って形式を満たす
    writeSSE('content_block_delta', {
      type: 'content_block_delta', index: blockIndex,
      delta: { type: 'signature_delta', signature: 'humanllm' },
    })
    writeSSE('content_block_stop', { type: 'content_block_stop', index: blockIndex })
  }
  const openText = () => {
    if (textOpen) return
    closeThinking()
    textOpen = true
    blockIndex++
    writeSSE('content_block_start', {
      type: 'content_block_start', index: blockIndex,
      content_block: { type: 'text', text: '' },
    })
  }
  const finish = (stopReason: 'end_turn' | 'tool_use') => {
    clearTimeout(timeoutHandle)
    writeSSE('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 0 },
    })
    writeSSE('message_stop', { type: 'message_stop' })
    socket.end()
  }

  addPending(
    requestId,
    messages,
    (deltaText) => {
      openText()
      armTimeout()
      writeSSE('content_block_delta', {
        type: 'content_block_delta', index: blockIndex,
        delta: { type: 'text_delta', text: deltaText },
      })
    },
    (_fullText) => {
      // delta は逐次送信済みなので、ここではブロックを閉じるだけ
      openText()
      writeSSE('content_block_stop', { type: 'content_block_stop', index: blockIndex })
      finish('end_turn')
    },
    () => { clearTimeout(timeoutHandle); socket.destroy() },
    (item) => {
      closeThinking()
      const block = toolUseBlock(item)
      blockIndex++
      writeSSE('content_block_start', {
        type: 'content_block_start', index: blockIndex,
        content_block: { ...block, input: {} },
      })
      writeSSE('content_block_delta', {
        type: 'content_block_delta', index: blockIndex,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      })
      writeSSE('content_block_stop', { type: 'content_block_stop', index: blockIndex })
      finish('tool_use')
    },
    (reasoningDelta) => {
      if (textOpen) return // 本文開始後の思考は受け付けない
      openThinking()
      armTimeout()
      writeSSE('content_block_delta', {
        type: 'content_block_delta', index: blockIndex,
        delta: { type: 'thinking_delta', thinking: reasoningDelta },
      })
    },
  )

  broadcast({ type: 'request', requestId, messages, model, createdAt, tools: toolInfos })
  armTimeout()
}
