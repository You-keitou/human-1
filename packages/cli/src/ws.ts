// 観測用 WebSocket クライアント(サーバーの全イベントを購読する)。
// train / theater 共通。指数バックオフで再接続し(成功接続ごとにバックオフをリセット)、
// 再接続時にサーバーが再送するスナップショット/replay を requestId で重複排除する。
//
// トークン衛生: 接続 URL には ?token= が載るため、エラーメッセージ・ログには
// token を含まない redacted URL(safeUrl)だけを使う。

import type { WsAnsweredMessage, WsServerMessage, WsTimeoutMessage } from '@human-1/shared'
import { normalizeServer } from './config'
import { dim, warn } from './log'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type ObserverOptions = {
  server: string
  token: string
  // 接続状態の変化(デバッグ表示用)。
  onStatus?: (status: 'open' | 'closed' | 'reconnecting') => void
}

export type RolloutEnd = {
  msg: WsAnsweredMessage | WsTimeoutMessage
  endIndex: number
  // この rollout に属すると判定した request の requestId 集合(transcript フィルタに使う)。
  requestIds: Set<string>
}

// 終端イベント(replay 含む)の重複排除キー。
function terminalKey(m: WsServerMessage): string | null {
  if (m.type === 'answered') return `answered:${m.requestId}`
  if (m.type === 'timeout') return `timeout:${m.requestId}`
  if (m.type === 'score') return `score:${m.rolloutId}`
  return null
}

export class Observer {
  // 受信した全メッセージ(request・終端は重複排除済み)。scan 系が走査する。
  readonly received: WsServerMessage[] = []
  private ws: WebSocket | null = null
  private closed = false
  private reconnectAttempt = 0
  private readonly seenRequestIds = new Set<string>()
  private readonly seenTerminals = new Set<string>()
  private readonly listeners = new Set<(m: WsServerMessage) => void>()
  private readonly url: string
  // token を含まない表示用 URL。
  private readonly safeUrl: string
  private readonly onStatus?: (status: 'open' | 'closed' | 'reconnecting') => void

  constructor(opts: ObserverOptions) {
    const base = normalizeServer(opts.server).replace(/^http/, 'ws')
    this.url = `${base}/ws?token=${encodeURIComponent(opts.token)}`
    this.safeUrl = `${base}/ws`
    this.onStatus = opts.onStatus
  }

  // 最初の接続確立まで待って解決する。以後の切断は内部で自動再接続する。
  connect(timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error(`WS 接続が ${timeoutMs}ms 以内に確立しませんでした: ${this.safeUrl}`))
      }, timeoutMs)

      const onOpen = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      this.spawn(onOpen)
    })
  }

  private spawn(onOpen?: () => void): void {
    if (this.closed) return
    const ws = new WebSocket(this.url)
    ws.onopen = () => {
      this.ws = ws
      this.reconnectAttempt = 0 // 成功接続ごとにバックオフをリセット
      this.onStatus?.('open')
      onOpen?.()
    }
    ws.onmessage = (e: MessageEvent) => this.onMessage(e)
    ws.onerror = () => {
      // onclose が続けて発火するので、そこで再接続する。
    }
    ws.onclose = () => {
      if (this.closed) return
      this.ws = null
      this.onStatus?.('reconnecting')
      const delay = Math.min(500 * 2 ** this.reconnectAttempt, 15_000)
      this.reconnectAttempt++
      warn(dim(`WS 切断 — ${Math.round(delay)}ms 後に再接続します(${this.safeUrl})`))
      void sleep(delay).then(() => this.spawn(onOpen))
    }
  }

  private onMessage(e: MessageEvent): void {
    let msg: WsServerMessage
    try {
      msg = JSON.parse(String(e.data)) as WsServerMessage
    } catch {
      return
    }
    // 再接続時に再送される request スナップショットを requestId で重複排除する。
    if (msg.type === 'request') {
      if (this.seenRequestIds.has(msg.requestId)) return
      this.seenRequestIds.add(msg.requestId)
    }
    // 終端イベント(answered / timeout / score)は replay されうる。最初の 1 回だけ受理する
    // (切断中に完了したリクエストの終端も replay を最初の 1 回として取りこぼさず拾える)。
    const tk = terminalKey(msg)
    if (tk !== null) {
      if (this.seenTerminals.has(tk)) return
      this.seenTerminals.add(tk)
    }
    this.received.push(msg)
    for (const l of this.listeners) l(msg)
  }

  subscribe(cb: (m: WsServerMessage) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  // rollout の終端を「マーカー相関」で待つ(監督者決定の方式)。
  // 出題プロンプトに埋め込んだ一意マーカーを messages 内に含む request だけを当該 rollout の
  // requestId 集合に加える(ツール連鎖の後続リクエストも会話履歴にプロンプトを持つので
  // 決定的に追従。無関係リクエスト — 素の curl 等 — はマーカーを持たないので排除される)。
  // その集合に属する answered / timeout を最初の 1 件だけ返す。
  // signal で敗者側 waiter を解除でき、後からの unhandled rejection を防ぐ。
  async waitForRolloutEnd(
    fromIndex: number,
    marker: string,
    timeoutMs = 45 * 60 * 1000,
    signal?: AbortSignal,
  ): Promise<RolloutEnd> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('rollout 終端待ちを中断しました')
      const ids = new Set<string>()
      for (let i = fromIndex; i < this.received.length; i++) {
        const m = this.received[i]
        if (!m) continue
        if (m.type === 'request') {
          if (m.messages.some((cm) => cm.content.includes(marker))) ids.add(m.requestId)
        } else if ((m.type === 'answered' || m.type === 'timeout') && ids.has(m.requestId)) {
          return { msg: m, endIndex: i, requestIds: ids }
        }
      }
      if (this.closed) throw new Error('WS が閉じられました')
      await sleep(100)
    }
    throw new Error('rollout の終端(answered / timeout)を待機中にタイムアウトしました')
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.onStatus?.('closed')
    try {
      this.ws?.close()
    } catch {
      // 既に閉じていれば無視
    }
    this.ws = null
  }
}
