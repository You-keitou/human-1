import type { WsResponseMessage, WsServerMessage } from '@human-1/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

// PoC hooks/useWebSocket.ts を移植・進化。
//  - `/ws?token=` で接続(トークンは呼び出し側から渡す)
//  - 指数バックオフ再接続(1s → 最大 30s、切断中も UI 側の編集は保持される)
//  - サーバー → クライアントの WsServerMessage を onMessage に渡す(重複排除は store 側で requestId 単位)

export type WsStatus = 'connecting' | 'open' | 'closed'

const BASE_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30_000

export function useWebSocket(
  token: string | null,
  onMessage: (msg: WsServerMessage) => void,
): { status: WsStatus; send: (msg: WsResponseMessage) => void } {
  const [status, setStatus] = useState<WsStatus>('connecting')
  const [attempt, setAttempt] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    if (!token) {
      setStatus('closed')
      return
    }
    let closedByCleanup = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setStatus('connecting')

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.addEventListener('open', () => {
      setStatus('open')
    })
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsServerMessage
        onMessageRef.current(msg)
      } catch {
        // 壊れたフレームは無視
      }
    })
    const scheduleRetry = (): void => {
      if (closedByCleanup) return
      setStatus('closed')
      // 指数バックオフ(attempt に応じて増加、上限 30s)。
      const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt)
      retryTimer = setTimeout(() => setAttempt((a) => a + 1), backoff)
    }
    ws.addEventListener('close', scheduleRetry)
    ws.addEventListener('error', () => {
      try {
        ws.close()
      } catch {
        // close イベントで scheduleRetry に合流
      }
    })

    return () => {
      closedByCleanup = true
      if (retryTimer) clearTimeout(retryTimer)
      try {
        ws.close()
      } catch {
        // no-op
      }
    }
  }, [token, attempt])

  const send = useCallback((msg: WsResponseMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  return { status, send }
}
