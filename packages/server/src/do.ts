import { DurableObject } from 'cloudflare:workers'
import type {
  ApiEndpoint,
  ChatMessage,
  Rollout,
  Score,
  ToolCallItem,
  TrainingRun,
  WsRequestMessage,
  WsResponseMessage,
  WsServerMessage,
} from '@human-1/shared'
import { handleMessages } from './messages'
import { handleResponses } from './responses'
import { handleApi } from './runs'

// 終端イベント履歴の保持件数と replay 対象の時間窓(過去 24h)。
const TERMINAL_HISTORY_MAX = 100
const TERMINAL_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000

// pending リクエスト 1 件ぶんのコールバック束(pendingRequests.ts 相当)。
// SSE ストリーム(または非ストリーム Promise)への橋渡しを、WS からの
// delta / reasoning / tool_calls / response で駆動する。
export type PendingRequest = {
  messages: ChatMessage[]
  endpoint: ApiEndpoint
  createdAt: number
  accumulated: string
  // 元の request イベント。WS 再接続時にこのスナップショットをそのまま再送する。
  snapshot: WsRequestMessage
  sendDelta: (text: string) => void
  // 本文開始前の思考(reasoning)。並列 tool より前・本文より前のみ意味を持つ。
  sendReasoning: (text: string) => void
  complete: (fullText: string) => void
  // 並列複数 tool call を一括確定する(human-1 の拡張)。
  completeTools: (items: ToolCallItem[]) => void
  reject: (reason: Error) => void
}

export class HumanLlmDO extends DurableObject<Env> {
  // 進行中リクエスト。メモリ常駐だが、SSE レスポンスが in-flight の間は DO が
  // メモリから退避されない(hibernation は WS だけが残るアイドル時に起きる)ため、
  // リクエストの生存期間中は安全に保持できる。
  private readonly pending = new Map<string, PendingRequest>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // スキーマ初期化のみを blockConcurrencyWhile で行う(DO ベストプラクティス)。
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rollouts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          task TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          score_value REAL,
          score_max REAL,
          score_comment TEXT,
          score_at INTEGER
        );
        -- 終端イベント(answered / timeout / score)の短期履歴リングバッファ。
        -- WS 切断窓中に完了したリクエストの終端は pending 削除済みでスナップショット再送に乗らないため、
        -- ここに永続化(hibernation を跨いで生存)して再接続時に replay する。
        CREATE TABLE IF NOT EXISTS terminal_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          event TEXT NOT NULL
        );
      `)
    })
  }

  // 応答待ちタイムアウト(ミリ秒)。env HUMAN_TIMEOUT_MS で上書き可、未設定/不正時は 30 分。
  // 人間は遅いので delta / reasoning 受信のたびにハンドラ側で再武装される。
  timeoutMs(): number {
    const raw = Number(this.env.HUMAN_TIMEOUT_MS)
    return Number.isFinite(raw) && raw > 0 ? raw : 30 * 60 * 1000
  }

  // ---------- ルーティング ----------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    if (path === '/ws') return this.handleWebSocketUpgrade(request)
    if (path === '/v1/responses') return handleResponses(this, request)
    if (path === '/v1/messages' || path === '/v1/messages/count_tokens')
      return handleMessages(this, request, path)
    if (path === '/v1/models') return this.handleModels()
    if (path.startsWith('/api/')) return handleApi(this, request, path)
    return new Response('not found', { status: 404 })
  }

  private handleModels(): Response {
    // OpenAI 形式(object/data)と codex 0.144.6 が期待する形式(models)を併記して両クライアントを満たす。
    const models = [
      {
        id: 'human',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'human-1',
      },
    ]
    return Response.json({ object: 'list', data: models, models })
  }

  // ---------- WebSocket(Hibernation API)----------

  private handleWebSocketUpgrade(request: Request): Response {
    if (request.headers.get('upgrade') !== 'websocket')
      return new Response('expected websocket', { status: 426 })
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    // acceptWebSocket により、アイドル時は DO をメモリから退避しつつ接続を維持できる。
    this.ctx.acceptWebSocket(server)
    // 再接続時の宙吊り対策(人間は遅い・スマホは切れやすい): in-flight な pending の
    // request イベントを新しい WS にだけ再送する。requestId は不変なので UI 側で重複排除できる。
    for (const req of this.pending.values()) {
      try {
        server.send(JSON.stringify(req.snapshot))
      } catch {
        // 送信不能なら無視
      }
    }
    // 切断窓中に完了した終端イベント(answered / timeout / score)も replay して復旧可能にする。
    this.replayTerminalEvents(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  // client → server。人間 UI / シミュレータからの応答を pending にディスパッチする。
  webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): void {
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message)
    let msg: WsResponseMessage
    try {
      msg = JSON.parse(raw) as WsResponseMessage
    } catch {
      return
    }
    switch (msg.type) {
      case 'response':
        this.resolvePending(msg.requestId, msg.content)
        break
      case 'delta':
        this.deltaPending(msg.requestId, msg.content)
        break
      case 'reasoning':
        // 観測者(トレーナー)にも思考を配信する。
        if (this.reasoningPending(msg.requestId, msg.content))
          this.broadcast({ type: 'thought', requestId: msg.requestId, content: msg.content })
        break
      case 'tool_calls':
        // 並列複数 tool call を一括確定し、観測者へ items 配列で配信する。
        if (this.resolveToolsPending(msg.requestId, msg.items))
          this.broadcast({ type: 'tool_called', requestId: msg.requestId, items: msg.items })
        break
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code)
    } catch {
      // 既に閉じている場合は無視
    }
  }

  // 全 WS へ配信(人間 UI・観測者トレーナー共通)。
  broadcast(msg: WsServerMessage): void {
    // 終端イベントは再接続 replay 用に履歴へ残す(生配信には replay を付けない)。
    if (msg.type === 'answered' || msg.type === 'timeout' || msg.type === 'score') {
      this.recordTerminal(msg)
    }
    const data = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data)
      } catch {
        // 送信不能なソケットは無視(close 時に破棄される)
      }
    }
  }

  // 終端イベントを追記し、古いものを刈る。件数キャップ(TERMINAL_HISTORY_MAX)に加え、
  // 保持期間(TERMINAL_HISTORY_WINDOW_MS)を超えた行も削除する。件数キャップだけだと
  // 古い回答内容が押し出されるまで SQLite に残り続けるため(告知どおりの保持期間に揃える)。
  private recordTerminal(msg: WsServerMessage): void {
    const now = Date.now()
    this.ctx.storage.sql.exec(
      'INSERT INTO terminal_events (at, event) VALUES (?, ?)',
      now,
      JSON.stringify(msg),
    )
    this.ctx.storage.sql.exec(
      'DELETE FROM terminal_events WHERE at < ?',
      now - TERMINAL_HISTORY_WINDOW_MS,
    )
    this.ctx.storage.sql.exec(
      'DELETE FROM terminal_events WHERE id NOT IN (SELECT id FROM terminal_events ORDER BY id DESC LIMIT ?)',
      TERMINAL_HISTORY_MAX,
    )
  }

  // 新規 WS へ、直近 TERMINAL_HISTORY_WINDOW_MS 内の終端イベントを古い順に replay: true 付きで再送する。
  private replayTerminalEvents(ws: WebSocket): void {
    const cutoff = Date.now() - TERMINAL_HISTORY_WINDOW_MS
    const rows = this.ctx.storage.sql
      .exec<{ event: string }>(
        'SELECT event FROM terminal_events WHERE at >= ? ORDER BY id ASC',
        cutoff,
      )
      .toArray()
    for (const row of rows) {
      try {
        const msg = JSON.parse(row.event) as WsServerMessage
        ws.send(JSON.stringify({ ...msg, replay: true }))
      } catch {
        // 壊れた履歴行は無視
      }
    }
  }

  // ---------- pending 管理(pendingRequests.ts 相当・並列 tool 対応)----------

  addPending(requestId: string, req: PendingRequest): void {
    this.pending.set(requestId, req)
  }

  deltaPending(requestId: string, text: string): boolean {
    const req = this.pending.get(requestId)
    if (!req) return false
    req.accumulated += text
    req.sendDelta(text)
    return true
  }

  reasoningPending(requestId: string, text: string): boolean {
    const req = this.pending.get(requestId)
    if (!req) return false
    req.sendReasoning(text)
    return true
  }

  resolvePending(requestId: string, finalText: string): boolean {
    const req = this.pending.get(requestId)
    if (!req) return false
    this.pending.delete(requestId)
    if (finalText) {
      req.accumulated += finalText
      req.sendDelta(finalText)
    }
    req.complete(req.accumulated)
    this.broadcast({ type: 'answered', requestId, content: req.accumulated })
    return true
  }

  resolveToolsPending(requestId: string, items: ToolCallItem[]): boolean {
    const req = this.pending.get(requestId)
    if (!req) return false
    this.pending.delete(requestId)
    req.completeTools(items)
    return true
  }

  rejectPending(requestId: string, reason: Error): boolean {
    const req = this.pending.get(requestId)
    if (!req) return false
    this.pending.delete(requestId)
    req.reject(reason)
    return true
  }

  // ---------- 永続化(runs / rollouts / scores)----------

  listRuns(): TrainingRun[] {
    const runs = this.ctx.storage.sql
      .exec<{ id: string; title: string; created_at: number }>(
        'SELECT id, title, created_at FROM runs ORDER BY created_at DESC',
      )
      .toArray()
    return runs.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      rolloutIds: this.rolloutIdsFor(r.id),
    }))
  }

  private rolloutIdsFor(runId: string): string[] {
    return this.ctx.storage.sql
      .exec<{ id: string }>(
        'SELECT id FROM rollouts WHERE run_id = ? ORDER BY started_at ASC',
        runId,
      )
      .toArray()
      .map((r) => r.id)
  }

  createRun(title: string): TrainingRun {
    const id = crypto.randomUUID()
    const createdAt = Date.now()
    this.ctx.storage.sql.exec(
      'INSERT INTO runs (id, title, created_at) VALUES (?, ?, ?)',
      id,
      title,
      createdAt,
    )
    return { id, title, createdAt, rolloutIds: [] }
  }

  getRun(id: string): TrainingRun | null {
    const row = this.ctx.storage.sql
      .exec<{ id: string; title: string; created_at: number }>(
        'SELECT id, title, created_at FROM runs WHERE id = ?',
        id,
      )
      .toArray()[0]
    if (!row) return null
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      rolloutIds: this.rolloutIdsFor(id),
    }
  }

  createRollout(runId: string, task: string): Rollout | null {
    if (!this.getRun(runId)) return null
    const id = crypto.randomUUID()
    const startedAt = Date.now()
    this.ctx.storage.sql.exec(
      'INSERT INTO rollouts (id, run_id, task, started_at) VALUES (?, ?, ?, ?)',
      id,
      runId,
      task,
      startedAt,
    )
    return { id, runId, task, startedAt }
  }

  getRollout(id: string): Rollout | null {
    const row = this.ctx.storage.sql
      .exec<{
        id: string
        run_id: string
        task: string
        started_at: number
        ended_at: number | null
        score_value: number | null
        score_max: number | null
        score_comment: string | null
        score_at: number | null
      }>('SELECT * FROM rollouts WHERE id = ?', id)
      .toArray()[0]
    if (!row) return null
    const rollout: Rollout = {
      id: row.id,
      runId: row.run_id,
      task: row.task,
      startedAt: row.started_at,
    }
    if (row.ended_at !== null) rollout.endedAt = row.ended_at
    if (row.score_value !== null && row.score_max !== null && row.score_at !== null) {
      rollout.score = {
        value: row.score_value,
        max: row.score_max,
        at: row.score_at,
        ...(row.score_comment !== null ? { comment: row.score_comment } : {}),
      }
    }
    return rollout
  }

  // score を付けずに rollout を終了する(タイムアウト/失敗した rollout の終端記録)。
  // 既に ended_at があれば上書きしない(採点済みを鈍化させない)。
  endRollout(rolloutId: string, at: number): Rollout | null {
    const existing = this.getRollout(rolloutId)
    if (!existing) return null
    if (existing.endedAt === undefined) {
      this.ctx.storage.sql.exec('UPDATE rollouts SET ended_at = ? WHERE id = ?', at, rolloutId)
    }
    return this.getRollout(rolloutId)
  }

  setScore(rolloutId: string, score: Score): Rollout | null {
    if (!this.getRollout(rolloutId)) return null
    this.ctx.storage.sql.exec(
      'UPDATE rollouts SET score_value = ?, score_max = ?, score_comment = ?, score_at = ?, ended_at = ? WHERE id = ?',
      score.value,
      score.max,
      score.comment ?? null,
      score.at,
      score.at,
      rolloutId,
    )
    return this.getRollout(rolloutId)
  }
}
