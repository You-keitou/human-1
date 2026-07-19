import type { IncomingMessage, ServerResponse } from 'http'
import type { ChatMessage, ToolCallItem, ToolInfo } from '../../shared/types'
import { addPending, rejectPending } from '../store/pendingRequests'
import { broadcast } from '../ws/clients'

// 人間は考えるのに時間がかかる。思考や途中経過を送るたびにタイマーは再武装される。
const TIMEOUT_MS = 30 * 60 * 1000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'object' && c !== null && 'text' in c ? (c as { text: string }).text : ''))
      .join('')
  }
  return String(content)
}

// Responses API input には role を持たない tool アイテム（function_call, function_call_output 等）が混在する。
// それらを ChatMessage に変換して人間が読める形にする。
// developer ロールは instructions 由来のシステムプロンプトなので system として扱う。
function normalizeInputItem(m: Record<string, unknown>): ChatMessage | null {
  const role = m.role as string | undefined
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return { role, content: normalizeContent(m.content) }
  }
  if (role === 'developer') {
    return { role: 'system', content: normalizeContent(m.content) }
  }
  const type = m.type as string | undefined
  if (type === 'function_call') {
    return { role: 'assistant', content: `[function_call: ${m.name}]\n${m.arguments ?? ''}` }
  }
  if (type === 'function_call_output') {
    return { role: 'user', content: `[function_call_output]\n${String(m.output ?? '')}` }
  }
  if (type === 'local_shell_call') {
    const action = m.action as { command?: string[] } | undefined
    return { role: 'assistant', content: `[local_shell_call: ${action?.command?.join(' ') ?? ''}]` }
  }
  if (type === 'local_shell_call_output') {
    return { role: 'user', content: `[local_shell_call_output]\n${String(m.output ?? '')}` }
  }
  if (type === 'message' && (m.role === 'user' || m.role === 'assistant' || m.role === 'system' || m.role === 'developer')) {
    const msgRole = m.role === 'developer' ? 'system' : m.role as ChatMessage['role']
    return { role: msgRole, content: normalizeContent(m.content) }
  }
  return null
}

function buildToolOutputItem(item: ToolCallItem, itemId: string): Record<string, unknown> {
  if (item.type === 'function_call') {
    return {
      id: itemId,
      type: 'function_call',
      call_id: item.callId,
      name: item.name,
      arguments: item.arguments,
      status: 'completed',
    }
  } else {
    const action: Record<string, unknown> = {
      type: 'exec',
      command: item.command,
      timeout_ms: 30000,
    }
    if (item.workingDirectory !== null) {
      action.working_directory = item.workingDirectory
    }
    return {
      id: itemId,
      type: 'local_shell_call',
      call_id: item.callId,
      action,
      status: 'completed',
    }
  }
}

export async function handleResponsesNode(req: IncomingMessage, res: ServerResponse): Promise<void> {
  console.log('[responses] POST /v1/responses method=' + req.method)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  const raw = await new Promise<string>((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })

  const body = JSON.parse(raw) as {
    model?: string
    input: string | Array<Record<string, unknown>>
    stream?: boolean
  }

  const { model = 'human', input, stream = false } = body
  const tools = (body as Record<string, unknown>).tools as Array<Record<string, unknown>> | undefined
  const instructions = (body as Record<string, unknown>).instructions as string | undefined
  console.log(`[responses] model=${model} stream=${stream} tools=${tools?.map((t) => t.name ?? (t.function as Record<string, unknown>)?.name).join(',') ?? 'none'}`)

  // ツール定義を UI 表示用に要約して転送する
  const toolInfos: ToolInfo[] = (tools ?? []).map((t) => {
    const fn = t.function as Record<string, unknown> | undefined
    const name = String(t.name ?? fn?.name ?? t.type ?? 'unknown')
    const description = (t.description ?? fn?.description) as string | undefined
    const parameters = t.parameters ?? fn?.parameters
    return { name, ...(description ? { description } : {}), ...(parameters ? { parameters } : {}) }
  })

  const inputMessages: ChatMessage[] = typeof input === 'string'
    ? [{ role: 'user', content: input }]
    : input.flatMap((m) => { const msg = normalizeInputItem(m); return msg ? [msg] : [] })

  // instructions はシステムプロンプト。input 内に同等の system/developer メッセージがなければ先頭に追加する。
  const hasSystemMessage = inputMessages.some((m) => m.role === 'system')
  const messages: ChatMessage[] = instructions && !hasSystemMessage
    ? [{ role: 'system', content: instructions }, ...inputMessages]
    : inputMessages

  const requestId = crypto.randomUUID()
  const respId = `resp_${requestId}`
  const msgId = `msg_${requestId}`
  const createdAt = Math.floor(Date.now() / 1000)

  // codex の裏方リクエスト(メモリ生成: rollout 解析)は人間を煩わせず自動応答する
  const flat = messages.map((m) => m.content).join('\n')
  if (flat.includes('Analyze this rollout') && flat.includes('rollout_slug')) {
    console.log('[responses] auto-answered background request (rollout analysis)')
    const canned = JSON.stringify({ raw_memory: '', rollout_summary: '', rollout_slug: '' })
    const output = [{
      type: 'message', id: msgId, role: 'assistant',
      content: [{ type: 'output_text', text: canned, annotations: [] }],
      status: 'completed',
    }]
    const responseJson = {
      id: respId, object: 'response', created_at: createdAt, model,
      status: 'completed', output,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    }
    if (!stream) {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS })
      res.end(JSON.stringify(responseJson))
      return
    }
    const sock = req.socket
    sock.setNoDelay(true)
    sock.write([
      'HTTP/1.1 200 OK', 'Content-Type: text/event-stream', 'Cache-Control: no-cache', 'Connection: keep-alive',
      ...Object.entries(CORS_HEADERS).map(([k, v]) => `${k}: ${v}`), '', '',
    ].join('\r\n'))
    const sse = (event: string, data: object) => sock.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    sse('response.created', { type: 'response.created', response: { id: respId, object: 'response', created_at: createdAt, status: 'in_progress', model, output: [] } })
    sse('response.output_item.added', { type: 'response.output_item.added', output_index: 0, item: { id: msgId, type: 'message', role: 'assistant', content: [], status: 'in_progress' } })
    sse('response.content_part.added', { type: 'response.content_part.added', item_id: msgId, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } })
    sse('response.output_text.delta', { type: 'response.output_text.delta', item_id: msgId, output_index: 0, content_index: 0, delta: canned })
    sse('response.output_text.done', { type: 'response.output_text.done', item_id: msgId, output_index: 0, content_index: 0, text: canned })
    sse('response.output_item.done', { type: 'response.output_item.done', output_index: 0, item: output[0] })
    sse('response.completed', { type: 'response.completed', response: responseJson })
    sock.end()
    return
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

    let output: Record<string, unknown>[]
    if (result.kind === 'text') {
      output = [{
        type: 'message', id: msgId, role: 'assistant',
        content: [{ type: 'output_text', text: result.text, annotations: [] }],
        status: 'completed',
      }]
    } else {
      const itemId = result.item.type === 'function_call' ? `fc_${requestId}` : `lsc_${requestId}`
      output = [buildToolOutputItem(result.item, itemId)]
    }

    const responseBody = JSON.stringify({
      id: respId, object: 'response', created_at: createdAt, model,
      status: 'completed',
      output,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS })
    res.end(responseBody)
    return
  }

  // SSE streaming
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

  writeSSE('response.created', {
    type: 'response.created',
    response: { id: respId, object: 'response', created_at: createdAt, status: 'in_progress', model, output: [] },
  })

  // タイムアウトは思考・途中経過のたびに再武装する(人間は考えるのが遅い)
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const armTimeout = () => {
    clearTimeout(timeoutHandle)
    timeoutHandle = setTimeout(() => {
      const rejected = rejectPending(requestId, new Error('timeout'))
      if (rejected) broadcast({ type: 'timeout', requestId })
    }, TIMEOUT_MS)
  }

  // reasoning(人間の思考)は output_index 0 の reasoning アイテムとしてストリームする
  const rsId = `rs_${requestId}`
  let reasoningText = ''
  let reasoningStarted = false
  let reasoningClosed = false

  const reasoningItem = () => ({
    id: rsId,
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: reasoningText }],
    status: 'completed',
  })

  const startReasoning = () => {
    if (reasoningStarted) return
    reasoningStarted = true
    writeSSE('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: 0,
      item: { id: rsId, type: 'reasoning', summary: [], status: 'in_progress' },
    })
    writeSSE('response.reasoning_summary_part.added', {
      type: 'response.reasoning_summary_part.added',
      item_id: rsId, output_index: 0, summary_index: 0,
      part: { type: 'summary_text', text: '' },
    })
  }

  const closeReasoning = () => {
    if (!reasoningStarted || reasoningClosed) return
    reasoningClosed = true
    writeSSE('response.reasoning_summary_text.done', {
      type: 'response.reasoning_summary_text.done',
      item_id: rsId, output_index: 0, summary_index: 0,
      text: reasoningText,
    })
    writeSSE('response.reasoning_summary_part.done', {
      type: 'response.reasoning_summary_part.done',
      item_id: rsId, output_index: 0, summary_index: 0,
      part: { type: 'summary_text', text: reasoningText },
    })
    writeSSE('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: 0,
      item: reasoningItem(),
    })
  }

  // reasoning アイテムの有無で本文・ツールの output_index が変わる
  const bodyIndex = () => (reasoningStarted ? 1 : 0)
  const finalOutputs = (bodyItem: Record<string, unknown>) =>
    reasoningStarted ? [reasoningItem(), bodyItem] : [bodyItem]

  // message 用の output_item.added/content_part.added はレスポンス種別が確定してから送信する
  let messageEventsStarted = false
  let messageIndex = 0
  const ensureMessageEventsStarted = () => {
    if (messageEventsStarted) return
    messageEventsStarted = true
    closeReasoning()
    messageIndex = bodyIndex()
    writeSSE('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: messageIndex,
      item: { id: msgId, type: 'message', role: 'assistant', content: [], status: 'in_progress' },
    })
    writeSSE('response.content_part.added', {
      type: 'response.content_part.added',
      item_id: msgId, output_index: messageIndex, content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    })
  }

  addPending(
    requestId,
    messages,
    (deltaText) => {
      ensureMessageEventsStarted()
      armTimeout()
      writeSSE('response.output_text.delta', {
        type: 'response.output_text.delta',
        item_id: msgId, output_index: messageIndex, content_index: 0,
        delta: deltaText,
      })
    },
    (fullText) => {
      ensureMessageEventsStarted()
      clearTimeout(timeoutHandle)
      writeSSE('response.output_text.done', {
        type: 'response.output_text.done',
        item_id: msgId, output_index: messageIndex, content_index: 0, text: fullText,
      })
      const completedMessage = {
        id: msgId, type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text: fullText, annotations: [] }],
        status: 'completed',
      }
      writeSSE('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: messageIndex,
        item: completedMessage,
      })
      writeSSE('response.completed', {
        type: 'response.completed',
        response: {
          id: respId, object: 'response', created_at: createdAt,
          status: 'completed', model,
          output: finalOutputs(completedMessage),
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        },
      })
      socket.end()
    },
    () => { clearTimeout(timeoutHandle); socket.destroy() },
    (item) => {
      console.log(`[responses] completeTool fired type=${item.type} writable=${socket.writable}`)
      clearTimeout(timeoutHandle)
      closeReasoning()
      const toolIndex = bodyIndex()
      const itemId = item.type === 'function_call' ? `fc_${requestId}` : `lsc_${requestId}`
      const completedItem = buildToolOutputItem(item, itemId)
      console.log('[responses] completedItem:', JSON.stringify(completedItem))
      const inProgressItem = { ...completedItem, status: 'in_progress' }

      writeSSE('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: toolIndex,
        item: inProgressItem,
      })

      // function_call の場合は SDK が要求する引数 delta/done イベントを送信する
      if (item.type === 'function_call') {
        writeSSE('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: itemId,
          output_index: toolIndex,
          delta: item.arguments,
        })
        writeSSE('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          item_id: itemId,
          output_index: toolIndex,
          arguments: item.arguments,
        })
      }

      writeSSE('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: toolIndex,
        item: completedItem,
      })
      writeSSE('response.completed', {
        type: 'response.completed',
        response: {
          id: respId, object: 'response', created_at: createdAt,
          status: 'completed', model,
          output: finalOutputs(completedItem),
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        },
      })
      socket.end()
    },
    (reasoningDelta) => {
      // 本文の出力が始まった後の思考は受け付けない(Responses API の構造上、前置きのみ)
      if (messageEventsStarted || reasoningClosed) return
      startReasoning()
      armTimeout()
      reasoningText += reasoningDelta
      writeSSE('response.reasoning_summary_text.delta', {
        type: 'response.reasoning_summary_text.delta',
        item_id: rsId, output_index: 0, summary_index: 0,
        delta: reasoningDelta,
      })
    },
  )

  broadcast({ type: 'request', requestId, messages, model, createdAt, tools: toolInfos })

  armTimeout()
}
