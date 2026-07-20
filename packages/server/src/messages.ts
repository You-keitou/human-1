import type { ChatMessage, ToolCallItem, ToolInfo, WsRequestMessage } from '@human-1/shared'
import { cannedMessagesText, detectBackground } from './background'
import type { HumanLlmDO } from './do'
import { json } from './http'
import { openSse } from './sse'

// Anthropic Messages API(/v1/messages)。Claude Code を ANTHROPIC_BASE_URL でここに向けると
// 人間が Claude になれる。人間は遅いので、思考・途中経過を送るたびにタイムアウトを再武装する。
// タイムアウト値は DO の timeoutMs()(env HUMAN_TIMEOUT_MS・既定 30 分)から取る。

type Block = Record<string, unknown>

// Anthropic 形式のエラーボディ。
function anthropicError(
  type: string,
  message: string,
): { type: 'error'; error: { type: string; message: string } } {
  return { type: 'error', error: { type, message } }
}

// タイムアウトは 400 で返す。Anthropic SDK は 408/409/429/5xx を自動再試行するため、
// それ以外の 4xx を選ぶことで「人間への二重出題」を防ぐ。invalid_request も同様に 400。
const NON_RETRYABLE_STATUS = 400

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')
  return content
    .map((b: Block) => {
      if (typeof b === 'string') return b
      switch (b.type) {
        case 'text':
          return String(b.text ?? '')
        case 'thinking':
          return `[thinking]\n${String(b.thinking ?? '')}`
        case 'tool_use':
          return `[tool_use: ${String(b.name ?? '')}]\n${JSON.stringify(b.input ?? {})}`
        case 'tool_result':
          return `[tool_result]\n${contentToText(b.content)}`
        case 'image':
          return '[image]'
        default:
          return `[${String(b.type ?? 'unknown')}]`
      }
    })
    .filter((s) => s.length > 0)
    .join('\n')
}

// ToolCallItem を Anthropic の tool_use ブロックへ変換する。
// local_shell_call は Claude Code に無いので Bash 相当として送る(PoC 踏襲)。
function toolUseBlock(item: ToolCallItem): {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
} {
  if (item.type === 'function_call') {
    let input: unknown = {}
    try {
      input = JSON.parse(item.arguments)
    } catch {
      input = { raw: item.arguments }
    }
    return { type: 'tool_use', id: `toolu_${item.callId}`, name: item.name, input }
  }
  const script = item.command.length >= 3 ? item.command[2] : item.command.join(' ')
  return { type: 'tool_use', id: `toolu_${item.callId}`, name: 'Bash', input: { command: script } }
}

type ParsedRequest = {
  model: string
  messages: ChatMessage[]
  toolInfos: ToolInfo[]
  stream: boolean
}

// 不正ボディ(非 JSON・messages 欠落/型違い)は各プロトコル形式の 400 を返すため、
// パースと正規化を try/catch でくくって Error を投げる。
function parseRequest(raw: string): ParsedRequest {
  const body = JSON.parse(raw) as {
    model?: string
    system?: unknown
    messages?: unknown
    tools?: Array<Record<string, unknown>>
    stream?: boolean
  }
  if (!Array.isArray(body.messages)) {
    throw new Error('messages: field required and must be an array')
  }
  const { model = 'human', system, tools, stream = false } = body

  const toolInfos: ToolInfo[] = (tools ?? []).map((t) => {
    const name = String(t.name ?? 'unknown')
    const description = t.description as string | undefined
    const parameters = t.input_schema
    return { name, ...(description ? { description } : {}), ...(parameters ? { parameters } : {}) }
  })

  const messages: ChatMessage[] = []
  if (system) messages.push({ role: 'system', content: contentToText(system) })
  for (const m of body.messages as Array<{ role?: string; content?: unknown }>) {
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    messages.push({ role, content: contentToText(m.content) })
  }

  return { model, messages, toolInfos, stream }
}

export async function handleMessages(
  ctx: HumanLlmDO,
  request: Request,
  path: string,
): Promise<Response> {
  const raw = await request.text()

  // トークン数概算だけ返す補助エンドポイント。
  if (path === '/v1/messages/count_tokens') {
    return json({ input_tokens: Math.max(1, Math.ceil(raw.length / 4)) })
  }

  let parsed: ParsedRequest
  try {
    parsed = parseRequest(raw)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'invalid request body'
    return json(anthropicError('invalid_request_error', message), NON_RETRYABLE_STATUS)
  }
  const { model, messages, toolInfos, stream } = parsed

  const requestId = crypto.randomUUID()
  const msgApiId = `msg_${requestId}`

  // Claude Code の裏方リクエスト(タイトル生成・サジェスト)はサーバーが即座に自動応答する。
  const background = detectBackground(messages)
  if (background === 'title' || background === 'suggestion') {
    return respondCanned(msgApiId, model, cannedMessagesText(background), stream)
  }

  // 元 request イベント。broadcast にも pending スナップショット(WS 再接続再送)にも使う。
  const snapshot: WsRequestMessage = {
    type: 'request',
    requestId,
    endpoint: 'messages',
    messages,
    model,
    createdAt: Math.floor(Date.now() / 1000),
    tools: toolInfos,
  }

  if (!stream) return respondBlocking(ctx, requestId, msgApiId, model, snapshot)
  return respondStreaming(ctx, requestId, msgApiId, model, snapshot, request)
}

// ---------- 裏方リクエストへの定型応答 ----------

function respondCanned(msgApiId: string, model: string, text: string, stream: boolean): Response {
  if (!stream) {
    return json({
      id: msgApiId,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    })
  }
  const sse = openSse()
  sse.write('message_start', {
    type: 'message_start',
    message: {
      id: msgApiId,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })
  sse.write('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })
  sse.write('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  })
  sse.write('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse.write('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 0 },
  })
  sse.write('message_stop', { type: 'message_stop' })
  sse.close()
  return sse.response
}

// ---------- 非ストリーム ----------

function respondBlocking(
  ctx: HumanLlmDO,
  requestId: string,
  msgApiId: string,
  model: string,
  snapshot: WsRequestMessage,
): Promise<Response> {
  type Result = { kind: 'text'; text: string } | { kind: 'tools'; items: ToolCallItem[] }
  return new Promise<Response>((resolve) => {
    let timeout: ReturnType<typeof setTimeout>
    const done = (result: Result) => {
      clearTimeout(timeout)
      const content =
        result.kind === 'text'
          ? [{ type: 'text', text: result.text }]
          : result.items.map(toolUseBlock)
      resolve(
        json({
          id: msgApiId,
          type: 'message',
          role: 'assistant',
          model,
          content,
          stop_reason: result.kind === 'tools' ? 'tool_use' : 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
      )
    }
    ctx.addPending(requestId, {
      messages: snapshot.messages,
      endpoint: 'messages',
      createdAt: Date.now(),
      accumulated: '',
      snapshot,
      sendDelta: () => {},
      sendReasoning: () => {},
      complete: (text) => done({ kind: 'text', text }),
      completeTools: (items) => done({ kind: 'tools', items }),
      reject: (e) => {
        // 生 500 は SDK に retryable と誤解され二重出題を招く。プロトコル準拠のエラー JSON を返す。
        clearTimeout(timeout)
        resolve(anthropicTimeoutResponse(e))
      },
    })
    ctx.broadcast(snapshot)
    timeout = setTimeout(() => {
      if (ctx.rejectPending(requestId, new Error('timeout')))
        ctx.broadcast({ type: 'timeout', requestId })
    }, ctx.timeoutMs())
  })
}

// タイムアウト等の reject を Anthropic 形式・非再試行ステータスで返す。
function anthropicTimeoutResponse(e: Error): Response {
  const message =
    e.message === 'timeout'
      ? 'The human did not respond within the allotted time.'
      : e.message || 'request aborted'
  return json(anthropicError('timeout_error', message), NON_RETRYABLE_STATUS)
}

// ---------- ストリーム(Anthropic content_block 構造)----------

function respondStreaming(
  ctx: HumanLlmDO,
  requestId: string,
  msgApiId: string,
  model: string,
  snapshot: WsRequestMessage,
  request: Request,
): Response {
  const sse = openSse()

  sse.write('message_start', {
    type: 'message_start',
    message: {
      id: msgApiId,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })

  let timeout: ReturnType<typeof setTimeout>
  const armTimeout = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      if (ctx.rejectPending(requestId, new Error('timeout')))
        ctx.broadcast({ type: 'timeout', requestId })
    }, ctx.timeoutMs())
  }

  // ブロック状態: thinking(あれば先頭)→ text または tool_use(複数可)。
  let blockIndex = -1
  let thinkingOpen = false
  let textOpen = false

  const openThinking = () => {
    if (thinkingOpen || textOpen) return
    thinkingOpen = true
    blockIndex++
    sse.write('content_block_start', {
      type: 'content_block_start',
      index: blockIndex,
      content_block: { type: 'thinking', thinking: '' },
    })
  }
  const closeThinking = () => {
    if (!thinkingOpen) return
    thinkingOpen = false
    // 署名は検証されないのでダミーの signature_delta を送って形式を満たす(PoC 知見)。
    sse.write('content_block_delta', {
      type: 'content_block_delta',
      index: blockIndex,
      delta: { type: 'signature_delta', signature: 'human-1' },
    })
    sse.write('content_block_stop', { type: 'content_block_stop', index: blockIndex })
  }
  const openText = () => {
    if (textOpen) return
    closeThinking()
    textOpen = true
    blockIndex++
    sse.write('content_block_start', {
      type: 'content_block_start',
      index: blockIndex,
      content_block: { type: 'text', text: '' },
    })
  }
  const closeText = () => {
    if (!textOpen) return
    textOpen = false
    sse.write('content_block_stop', { type: 'content_block_stop', index: blockIndex })
  }
  const finish = (stopReason: 'end_turn' | 'tool_use') => {
    clearTimeout(timeout)
    sse.write('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 0 },
    })
    sse.write('message_stop', { type: 'message_stop' })
    sse.close()
  }

  ctx.addPending(requestId, {
    messages: snapshot.messages,
    endpoint: 'messages',
    createdAt: Date.now(),
    accumulated: '',
    snapshot,
    sendDelta: (deltaText) => {
      openText()
      armTimeout()
      sse.write('content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'text_delta', text: deltaText },
      })
    },
    complete: () => {
      // delta は逐次送信済み。ここでは本文ブロックを閉じて終了する。
      openText()
      closeText()
      finish('end_turn')
    },
    completeTools: (items) => {
      // delta で本文が始まっていれば、開いた text ブロックを先に閉じてから tool へ移る。
      // 未閉鎖のまま tool_use に移ると content_block が壊れる(QA 実測バグ)。
      if (textOpen) closeText()
      else closeThinking()
      // 並列複数 tool call: tool_use ブロックを複数積む。
      for (const item of items) {
        const block = toolUseBlock(item)
        blockIndex++
        sse.write('content_block_start', {
          type: 'content_block_start',
          index: blockIndex,
          content_block: { ...block, input: {} },
        })
        sse.write('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
        })
        sse.write('content_block_stop', { type: 'content_block_stop', index: blockIndex })
      }
      finish('tool_use')
    },
    reject: (e) => {
      // タイムアウトは event: error を送ってから正しく閉じる(途中 EOF は retryable 扱いされる)。
      // クライアント切断時は相手が居ないので黙って閉じる。
      clearTimeout(timeout)
      if (e.message === 'timeout') {
        sse.write(
          'error',
          anthropicError('timeout_error', 'The human did not respond within the allotted time.'),
        )
      }
      sse.close()
    },
    sendReasoning: (reasoningDelta) => {
      if (textOpen) return // 本文開始後の思考は受け付けない
      openThinking()
      armTimeout()
      sse.write('content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'thinking_delta', thinking: reasoningDelta },
      })
    },
  })

  // クライアント切断で pending を破棄する。
  request.signal.addEventListener('abort', () => {
    if (ctx.rejectPending(requestId, new Error('client disconnected'))) sse.close()
  })

  ctx.broadcast(snapshot)
  armTimeout()
  return sse.response
}
