// SSE(text/event-stream)レスポンスを最後まで読み、イベント列にパースするヘルパ。
// サーバーは `event: <name>\ndata: <json>\n\n` 形式で書く(sse.ts)。

export type SseEvent = { event: string; data: Record<string, unknown> }

export async function readSse(res: Response): Promise<SseEvent[]> {
  if (!res.body) throw new Error('SSE レスポンスに body がありません')
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const events: SseEvent[] = []

  const flush = (block: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length === 0) return
    const raw = dataLines.join('\n')
    events.push({ event, data: JSON.parse(raw) as Record<string, unknown> })
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx = buf.indexOf('\n\n')
    while (idx !== -1) {
      flush(buf.slice(0, idx))
      buf = buf.slice(idx + 2)
      idx = buf.indexOf('\n\n')
    }
  }
  if (buf.trim().length > 0) flush(buf)
  return events
}

// data 部だけを取り出す薄いユーティリティ。
export const eventTypes = (events: SseEvent[]): string[] => events.map((e) => e.event)
