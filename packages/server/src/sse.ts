import { CORS_HEADERS } from './http'

// Workers 版 SSE ヘルパ。Node の res.write() の代わりに TransformStream の writer へ書き込む。
// write は書き込みを await しない(順序はシングルスレッドで保たれる)。close 後の write は無視する。
export type Sse = {
  response: Response
  write: (event: string, data: unknown) => void
  close: () => void
  isClosed: () => boolean
}

export function openSse(extraHeaders: Record<string, string> = {}): Sse {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const enc = new TextEncoder()
  let closed = false

  const write = (event: string, data: unknown): void => {
    if (closed) return
    writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {
      closed = true
    })
  }
  const close = (): void => {
    if (closed) return
    closed = true
    writer.close().catch(() => {})
  }

  const response = new Response(readable, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  })
  return { response, write, close, isClosed: () => closed }
}
