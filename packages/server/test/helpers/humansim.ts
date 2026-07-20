// 人間シミュレータ: サーバーの WS へ接続し、request イベントに応じて
// 設定されたシナリオ(reasoning → tool_calls → 継続 → response 等)を返す。
// 観測イベント(thought / tool_called / answered / score / request / timeout)は
// すべて received に蓄積し、waitFor でタイムアウト付きに待てる。
import type { ToolCallItem, WsRequestMessage, WsServerMessage } from '@human-1/shared'

export type SimHandler = (req: WsRequestMessage, sim: HumanSim) => void | Promise<void>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class HumanSim {
  readonly received: WsServerMessage[] = []
  private handler: SimHandler | null = null

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (e: MessageEvent) => this.onMessage(e)
  }

  static connect(url: string, timeoutMs = 10_000): Promise<HumanSim> {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url)
      const timer = setTimeout(() => rej(new Error('WS 接続がタイムアウトしました')), timeoutMs)
      ws.onopen = () => {
        clearTimeout(timer)
        res(new HumanSim(ws))
      }
      ws.onerror = () => {
        clearTimeout(timer)
        rej(new Error('WS 接続に失敗しました'))
      }
    })
  }

  private onMessage(e: MessageEvent): void {
    let msg: WsServerMessage
    try {
      msg = JSON.parse(String(e.data)) as WsServerMessage
    } catch {
      return
    }
    this.received.push(msg)
    if (msg.type === 'request' && this.handler) void this.handler(msg, this)
  }

  // 次のテストのためにシナリオと受信バッファをリセットする。
  reset(): void {
    this.handler = null
    this.received.length = 0
  }

  onRequest(h: SimHandler): void {
    this.handler = h
  }

  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj))
  }

  reasoning(requestId: string, content: string): void {
    this.send({ type: 'reasoning', requestId, content })
  }

  delta(requestId: string, content: string): void {
    this.send({ type: 'delta', requestId, content })
  }

  respond(requestId: string, content: string): void {
    this.send({ type: 'response', requestId, content })
  }

  toolCalls(requestId: string, items: ToolCallItem[]): void {
    this.send({ type: 'tool_calls', requestId, items })
  }

  // received を走査して述語に合う最初のメッセージを返す。無ければタイムアウト。
  async waitFor<T extends WsServerMessage['type']>(
    type: T,
    predicate: (m: Extract<WsServerMessage, { type: T }>) => boolean = () => true,
    timeoutMs = 8000,
  ): Promise<Extract<WsServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const found = this.received.find(
        (m): m is Extract<WsServerMessage, { type: T }> =>
          m.type === type && predicate(m as Extract<WsServerMessage, { type: T }>),
      )
      if (found) return found
      await sleep(20)
    }
    throw new Error(`WS メッセージ ${type} を ${timeoutMs}ms 以内に受信しませんでした`)
  }

  // ある型のメッセージが「来ないこと」を確認する(裏方リクエストの非配信検証用)。
  async expectNone<T extends WsServerMessage['type']>(type: T, windowMs = 500): Promise<void> {
    await sleep(windowMs)
    if (this.received.some((m) => m.type === type))
      throw new Error(`WS メッセージ ${type} が配信されました(配信されないはず)`)
  }

  close(): void {
    this.ws.close()
  }
}
