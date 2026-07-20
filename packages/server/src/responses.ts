import type { ChatMessage, ToolCallItem, ToolInfo, WsRequestMessage } from '@human-1/shared'
import { cannedRolloutText, detectBackground } from './background'
import type { HumanLlmDO } from './do'
import { json } from './http'
import { openSse } from './sse'

// OpenAI Responses API(/v1/responses)。codex をここに向けると人間が出題対象になる。
// タイムアウト値は DO の timeoutMs()(env HUMAN_TIMEOUT_MS・既定 30 分)から取る。

// OpenAI 形式のエラーボディ。
function openaiError(
  type: string,
  message: string,
): { error: { message: string; type: string; param: null; code: null } } {
  return { error: { message, type, param: null, code: null } }
}

// タイムアウトは 400 で返す。OpenAI SDK は 408/409/429/5xx を自動再試行するため、
// それ以外の 4xx を選ぶことで「人間への二重出題」を防ぐ。invalid_request も同様に 400。
const NON_RETRYABLE_STATUS = 400

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        typeof c === 'object' && c !== null && 'text' in c ? (c as { text: string }).text : '',
      )
      .join('')
  }
  return String(content)
}

// Responses API input には role を持たない tool アイテムが混在する。ChatMessage へ正規化する。
// developer ロールは instructions 由来のシステムプロンプトなので system として扱う。
function normalizeInputItem(m: Record<string, unknown>): ChatMessage | null {
  const role = m.role as string | undefined
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return { role, content: normalizeContent(m.content) }
  }
  if (role === 'developer') return { role: 'system', content: normalizeContent(m.content) }
  const type = m.type as string | undefined
  if (type === 'function_call')
    return { role: 'assistant', content: `[function_call: ${m.name}]\n${m.arguments ?? ''}` }
  if (type === 'function_call_output')
    return { role: 'user', content: `[function_call_output]\n${String(m.output ?? '')}` }
  if (type === 'local_shell_call') {
    const action = m.action as { command?: string[] } | undefined
    return { role: 'assistant', content: `[local_shell_call: ${action?.command?.join(' ') ?? ''}]` }
  }
  if (type === 'local_shell_call_output')
    return { role: 'user', content: `[local_shell_call_output]\n${String(m.output ?? '')}` }
  if (
    type === 'message' &&
    (m.role === 'user' || m.role === 'assistant' || m.role === 'system' || m.role === 'developer')
  ) {
    const msgRole = m.role === 'developer' ? 'system' : (m.role as ChatMessage['role'])
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
  }
  const action: Record<string, unknown> = { type: 'exec', command: item.command, timeout_ms: 30000 }
  if (item.workingDirectory !== null) action.working_directory = item.workingDirectory
  return { id: itemId, type: 'local_shell_call', call_id: item.callId, action, status: 'completed' }
}

const itemIdFor = (item: ToolCallItem, i: number) =>
  item.type === 'function_call'
    ? `fc_${i}_${crypto.randomUUID()}`
    : `lsc_${i}_${crypto.randomUUID()}`

type ParsedRequest = {
  model: string
  messages: ChatMessage[]
  toolInfos: ToolInfo[]
  stream: boolean
}

// 不正ボディ(非 JSON・input 欠落/型違い)は 400 を返すため、パースと正規化を try/catch でくくる。
function parseRequest(raw: string): ParsedRequest {
  const body = JSON.parse(raw) as {
    model?: string
    input?: unknown
    stream?: boolean
    tools?: Array<Record<string, unknown>>
    instructions?: string
  }
  const { model = 'human', input, stream = false, tools, instructions } = body
  if (typeof input !== 'string' && !Array.isArray(input)) {
    throw new Error('input: field required and must be a string or an array')
  }

  const toolInfos: ToolInfo[] = (tools ?? []).map((t) => {
    const fn = t.function as Record<string, unknown> | undefined
    const name = String(t.name ?? fn?.name ?? t.type ?? 'unknown')
    const description = (t.description ?? fn?.description) as string | undefined
    const parameters = t.parameters ?? fn?.parameters
    return { name, ...(description ? { description } : {}), ...(parameters ? { parameters } : {}) }
  })

  const inputMessages: ChatMessage[] =
    typeof input === 'string'
      ? [{ role: 'user', content: input }]
      : input.flatMap((m) => {
          const msg = normalizeInputItem(m as Record<string, unknown>)
          return msg ? [msg] : []
        })

  // instructions はシステムプロンプト。同等の system が無ければ先頭に追加する。
  const hasSystem = inputMessages.some((m) => m.role === 'system')
  const messages: ChatMessage[] =
    instructions && !hasSystem
      ? [{ role: 'system', content: instructions }, ...inputMessages]
      : inputMessages

  return { model, messages, toolInfos, stream }
}

export async function handleResponses(ctx: HumanLlmDO, request: Request): Promise<Response> {
  const raw = await request.text()

  let parsed: ParsedRequest
  try {
    parsed = parseRequest(raw)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'invalid request body'
    return json(openaiError('invalid_request_error', message), NON_RETRYABLE_STATUS)
  }
  const { model, messages, toolInfos, stream } = parsed

  const requestId = crypto.randomUUID()
  const respId = `resp_${requestId}`
  const msgId = `msg_${requestId}`
  const createdAt = Math.floor(Date.now() / 1000)

  // codex の裏方リクエスト(rollout メモリ生成)はサーバーが即座に自動応答する。
  if (detectBackground(messages) === 'rollout') {
    return respondCannedRollout(respId, msgId, model, createdAt, stream)
  }

  // 元 request イベント。broadcast にも pending スナップショット(WS 再接続再送)にも使う。
  const snapshot: WsRequestMessage = {
    type: 'request',
    requestId,
    endpoint: 'responses',
    messages,
    model,
    createdAt,
    tools: toolInfos,
  }

  if (!stream) return respondBlocking(ctx, requestId, respId, msgId, model, createdAt, snapshot)
  return respondStreaming(ctx, requestId, respId, msgId, model, createdAt, snapshot, request)
}

// ---------- 裏方リクエストへの定型応答 ----------

function respondCannedRollout(
  respId: string,
  msgId: string,
  model: string,
  createdAt: number,
  stream: boolean,
): Response {
  const canned = cannedRolloutText()
  const output = [
    {
      type: 'message',
      id: msgId,
      role: 'assistant',
      content: [{ type: 'output_text', text: canned, annotations: [] }],
      status: 'completed',
    },
  ]
  const responseJson = {
    id: respId,
    object: 'response',
    created_at: createdAt,
    model,
    status: 'completed',
    output,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  }
  if (!stream) return json(responseJson)
  const sse = openSse()
  sse.write('response.created', {
    type: 'response.created',
    response: {
      id: respId,
      object: 'response',
      created_at: createdAt,
      status: 'in_progress',
      model,
      output: [],
    },
  })
  sse.write('response.output_item.added', {
    type: 'response.output_item.added',
    output_index: 0,
    item: { id: msgId, type: 'message', role: 'assistant', content: [], status: 'in_progress' },
  })
  sse.write('response.content_part.added', {
    type: 'response.content_part.added',
    item_id: msgId,
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  })
  sse.write('response.output_text.delta', {
    type: 'response.output_text.delta',
    item_id: msgId,
    output_index: 0,
    content_index: 0,
    delta: canned,
  })
  sse.write('response.output_text.done', {
    type: 'response.output_text.done',
    item_id: msgId,
    output_index: 0,
    content_index: 0,
    text: canned,
  })
  sse.write('response.output_item.done', {
    type: 'response.output_item.done',
    output_index: 0,
    item: output[0],
  })
  sse.write('response.completed', { type: 'response.completed', response: responseJson })
  sse.close()
  return sse.response
}

// ---------- 非ストリーム ----------

function respondBlocking(
  ctx: HumanLlmDO,
  requestId: string,
  respId: string,
  msgId: string,
  model: string,
  createdAt: number,
  snapshot: WsRequestMessage,
): Promise<Response> {
  type Result = { kind: 'text'; text: string } | { kind: 'tools'; items: ToolCallItem[] }
  return new Promise<Response>((resolve) => {
    let timeout: ReturnType<typeof setTimeout>
    const done = (result: Result) => {
      clearTimeout(timeout)
      const output: Record<string, unknown>[] =
        result.kind === 'text'
          ? [
              {
                type: 'message',
                id: msgId,
                role: 'assistant',
                content: [{ type: 'output_text', text: result.text, annotations: [] }],
                status: 'completed',
              },
            ]
          : result.items.map((item, i) => buildToolOutputItem(item, itemIdFor(item, i)))
      resolve(
        json({
          id: respId,
          object: 'response',
          created_at: createdAt,
          model,
          status: 'completed',
          output,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        }),
      )
    }
    ctx.addPending(requestId, {
      messages: snapshot.messages,
      endpoint: 'responses',
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
        resolve(openaiTimeoutResponse(e))
      },
    })
    ctx.broadcast(snapshot)
    timeout = setTimeout(() => {
      if (ctx.rejectPending(requestId, new Error('timeout')))
        ctx.broadcast({ type: 'timeout', requestId })
    }, ctx.timeoutMs())
  })
}

// タイムアウト等の reject を OpenAI 形式・非再試行ステータスで返す。
function openaiTimeoutResponse(e: Error): Response {
  const message =
    e.message === 'timeout'
      ? 'The human did not respond within the allotted time.'
      : e.message || 'request aborted'
  return json(openaiError('timeout_error', message), NON_RETRYABLE_STATUS)
}

// ---------- ストリーム(Responses イベント列 + reasoning summary)----------

function respondStreaming(
  ctx: HumanLlmDO,
  requestId: string,
  respId: string,
  msgId: string,
  model: string,
  createdAt: number,
  snapshot: WsRequestMessage,
  request: Request,
): Response {
  const sse = openSse()

  sse.write('response.created', {
    type: 'response.created',
    response: {
      id: respId,
      object: 'response',
      created_at: createdAt,
      status: 'in_progress',
      model,
      output: [],
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

  // reasoning(人間の思考)は output_index 0 の reasoning アイテムとしてストリームする。
  const rsId = `rs_${requestId}`
  let reasoningText = ''
  let reasoningStarted = false
  let reasoningClosed = false
  // delta で確定した本文テキスト。delta の後に tool へ移る場合に message アイテムへ含める。
  let accumulatedText = ''

  const reasoningItem = () => ({
    id: rsId,
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: reasoningText }],
    status: 'completed',
  })
  const startReasoning = () => {
    if (reasoningStarted) return
    reasoningStarted = true
    sse.write('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: 0,
      item: { id: rsId, type: 'reasoning', summary: [], status: 'in_progress' },
    })
    sse.write('response.reasoning_summary_part.added', {
      type: 'response.reasoning_summary_part.added',
      item_id: rsId,
      output_index: 0,
      summary_index: 0,
      part: { type: 'summary_text', text: '' },
    })
  }
  const closeReasoning = () => {
    if (!reasoningStarted || reasoningClosed) return
    reasoningClosed = true
    sse.write('response.reasoning_summary_text.done', {
      type: 'response.reasoning_summary_text.done',
      item_id: rsId,
      output_index: 0,
      summary_index: 0,
      text: reasoningText,
    })
    sse.write('response.reasoning_summary_part.done', {
      type: 'response.reasoning_summary_part.done',
      item_id: rsId,
      output_index: 0,
      summary_index: 0,
      part: { type: 'summary_text', text: reasoningText },
    })
    sse.write('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: 0,
      item: reasoningItem(),
    })
  }

  // reasoning アイテムの有無で本文・ツールの output_index 起点が変わる。
  const bodyIndex = () => (reasoningStarted ? 1 : 0)
  const finalOutputs = (bodyItems: Record<string, unknown>[]) =>
    reasoningStarted ? [reasoningItem(), ...bodyItems] : bodyItems
  const completeResponse = (outputs: Record<string, unknown>[]) => {
    sse.write('response.completed', {
      type: 'response.completed',
      response: {
        id: respId,
        object: 'response',
        created_at: createdAt,
        status: 'completed',
        model,
        output: outputs,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      },
    })
    sse.close()
  }

  // message 用イベントはレスポンス種別が確定してから送る。
  let messageEventsStarted = false
  let messageIndex = 0
  const ensureMessageEventsStarted = () => {
    if (messageEventsStarted) return
    messageEventsStarted = true
    closeReasoning()
    messageIndex = bodyIndex()
    sse.write('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: messageIndex,
      item: { id: msgId, type: 'message', role: 'assistant', content: [], status: 'in_progress' },
    })
    sse.write('response.content_part.added', {
      type: 'response.content_part.added',
      item_id: msgId,
      output_index: messageIndex,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    })
  }

  // 途中まで開いた message アイテムを accumulatedText 込みで確定して返す(delta→tools 用)。
  const finalizeMessageItem = (): Record<string, unknown> => {
    sse.write('response.output_text.done', {
      type: 'response.output_text.done',
      item_id: msgId,
      output_index: messageIndex,
      content_index: 0,
      text: accumulatedText,
    })
    const completedMessage = {
      id: msgId,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: accumulatedText, annotations: [] }],
      status: 'completed',
    }
    sse.write('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: messageIndex,
      item: completedMessage,
    })
    return completedMessage
  }

  ctx.addPending(requestId, {
    messages: snapshot.messages,
    endpoint: 'responses',
    createdAt: Date.now(),
    accumulated: '',
    snapshot,
    sendDelta: (deltaText) => {
      ensureMessageEventsStarted()
      armTimeout()
      accumulatedText += deltaText
      sse.write('response.output_text.delta', {
        type: 'response.output_text.delta',
        item_id: msgId,
        output_index: messageIndex,
        content_index: 0,
        delta: deltaText,
      })
    },
    complete: (fullText) => {
      ensureMessageEventsStarted()
      clearTimeout(timeout)
      accumulatedText = fullText
      const completedMessage = finalizeMessageItem()
      completeResponse(finalOutputs([completedMessage]))
    },
    completeTools: (items) => {
      clearTimeout(timeout)
      // delta で本文が始まっていれば message アイテムを途中テキスト込みで先に閉じ、tool を続く index に置く。
      // 閉じずに function_call を同じ index へ積むと途中テキストが最終 output から欠落する(QA 実測バグ)。
      const bodyItems: Record<string, unknown>[] = []
      let nextIndex: number
      if (messageEventsStarted) {
        bodyItems.push(finalizeMessageItem())
        nextIndex = messageIndex + 1
      } else {
        closeReasoning()
        nextIndex = bodyIndex()
      }
      // 並列複数 tool call: function_call / local_shell_call item を順に output へ積む。
      items.forEach((item, i) => {
        const toolIndex = nextIndex + i
        const itemId = itemIdFor(item, i)
        const completedItem = buildToolOutputItem(item, itemId)
        bodyItems.push(completedItem)
        sse.write('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: toolIndex,
          item: { ...completedItem, status: 'in_progress' },
        })
        if (item.type === 'function_call') {
          sse.write('response.function_call_arguments.delta', {
            type: 'response.function_call_arguments.delta',
            item_id: itemId,
            output_index: toolIndex,
            delta: item.arguments,
          })
          sse.write('response.function_call_arguments.done', {
            type: 'response.function_call_arguments.done',
            item_id: itemId,
            output_index: toolIndex,
            arguments: item.arguments,
          })
        }
        sse.write('response.output_item.done', {
          type: 'response.output_item.done',
          output_index: toolIndex,
          item: completedItem,
        })
      })
      completeResponse(finalOutputs(bodyItems))
    },
    reject: (e) => {
      clearTimeout(timeout)
      // クライアント切断時は相手が居ないので黙って閉じる。
      if (e.message !== 'timeout') {
        sse.close()
        return
      }
      // タイムアウトは「正常終了」でマスクして閉じる。response.failed は codex が retryable と
      // 解釈して再送し人間へ二重出題するため使わない(実クライアントトレースで確認済み)。
      // 人間・トレーナーへの通知は WS timeout イベントが担う。告知テキストを載せた message を出力する。
      const notice = '[human-1] timeout: 人間から回答が得られませんでした(HUMAN_TIMEOUT_MS 超過)'
      ensureMessageEventsStarted()
      // 既に途中テキストがあれば末尾に告知を追記。無ければ告知のみ。
      const noticeDelta = accumulatedText ? `\n\n${notice}` : notice
      accumulatedText += noticeDelta
      sse.write('response.output_text.delta', {
        type: 'response.output_text.delta',
        item_id: msgId,
        output_index: messageIndex,
        content_index: 0,
        delta: noticeDelta,
      })
      const completedMessage = finalizeMessageItem()
      completeResponse(finalOutputs([completedMessage]))
    },
    sendReasoning: (reasoningDelta) => {
      // 本文開始後の思考は受け付けない(Responses API は前置き reasoning のみ)。
      if (messageEventsStarted || reasoningClosed) return
      startReasoning()
      armTimeout()
      reasoningText += reasoningDelta
      sse.write('response.reasoning_summary_text.delta', {
        type: 'response.reasoning_summary_text.delta',
        item_id: rsId,
        output_index: 0,
        summary_index: 0,
        delta: reasoningDelta,
      })
    },
  })

  request.signal.addEventListener('abort', () => {
    if (ctx.rejectPending(requestId, new Error('client disconnected'))) sse.close()
  })

  ctx.broadcast(snapshot)
  armTimeout()
  return sse.response
}
