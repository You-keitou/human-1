// server 統合テスト(人間シミュレータ方式)。
// wrangler dev をヘッドレスで 1 回起動し、実サーバーへ HTTP / WS で疎通する。
// WS クライアント(HumanSim)が request イベントを購読して自動回答し、
// API クライアント視点(OpenAI / Anthropic 互換)の応答を検証する。
//
// 仕様(実装ではなく CLAUDE.md / API 互換仕様)から導出。実装のバグは
// テストを曲げず、失敗のまま残す。
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ToolCallItem } from '@human-1/shared'
import { HumanSim } from './helpers/humansim'
import { readSse, type SseEvent } from './helpers/sse'
import { type ServerHandle, startWrangler, startWranglerInstance } from './helpers/wrangler'

let server: ServerHandle
let sim: HumanSim

const TEST_TIMEOUT = 20_000

beforeAll(async () => {
  server = await startWrangler()
  sim = await HumanSim.connect(server.wsUrl(server.token))
  // 人間往復で worker をリロード窓の先まで温める(以降の mutating POST は素の fetch で 503 を踏まない)。
  await primeRoundTrip(server, sim)
}, 90_000)

afterAll(async () => {
  sim?.close()
  await server?.stop()
})

// ---------- HTTP ヘルパ ----------

type AuthKind = 'bearer' | 'apikey' | 'none'

function authHeaders(kind: AuthKind, token = server.token): Record<string, string> {
  if (kind === 'bearer') return { authorization: `Bearer ${token}` }
  if (kind === 'apikey') return { 'x-api-key': token }
  return {}
}

// GET / readiness / priming 専用の 503 リトライ。wrangler dev はブート直後にワーカーを
// リロードし、その間のリクエストは DO に届かず一時的な 503 を返す。冪等な読み取り(GET)と、
// 副作用のない使い捨ての priming に限りリトライする(codex #7: mutating な POST は再試行しない
// — タイムアウト/採点/作成が二重に走るのを避けるため)。
async function getRetry(input: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(input, init)
      if (res.status !== 503) return res
      await res.text()
    } catch {
      // 接続断も一時的とみなしてリトライ
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return fetch(input, init)
}

// 実テストの mutating POST はリトライしない(素の fetch)。priming で worker を温めてある前提。
function postJson(
  path: string,
  body: unknown,
  { auth = 'bearer' as AuthKind, token }: { auth?: AuthKind; token?: string } = {},
): Promise<Response> {
  return fetch(`${server.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(auth, token ?? server.token) },
    body: JSON.stringify(body),
  })
}

// beforeAll の priming: 人間が即答する 1 往復で worker をブート直後のリロード窓の先まで温める。
// /v1/messages は非永続なので使い捨てで、503 リトライ(getRetry)して確実に貫通させてよい。
async function primeRoundTrip(handle: ServerHandle, s: HumanSim): Promise<void> {
  s.reset()
  s.onRequest((req) => s.respond(req.requestId, 'prime'))
  const res = await getRetry(`${handle.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${handle.token}` },
    body: JSON.stringify({
      model: 'human',
      messages: [{ role: 'user', content: 'prime' }],
      stream: false,
    }),
  })
  await res.text()
  s.reset()
}

// 認証拒否検証専用の安全なリトライ。未認証 POST は Worker 層で 401 になり DO へ届かない
// (人間への出題も作成も走らない=副作用ゼロ)ため、401 が確定するまでリトライできる。
// wrangler dev の起動直後 isolate スワップで稀に混じる一時 503 を吸収する。
async function fetchAuthReject(url: string): Promise<{ res: Response; transient: number[] }> {
  const transient: number[] = []
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.status === 401) return { res, transient }
      transient.push(res.status)
      await res.text()
    } catch {
      transient.push(-1)
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  return { res: await fetch(url, init), transient }
}

const asObj = (v: unknown): Record<string, unknown> => (v ?? {}) as Record<string, unknown>
const dataType = (e: SseEvent): string => String(e.event)

// ---------- 1. 認証 ----------

describe('認証', () => {
  test(
    'トークンなし → 401',
    async () => {
      const res = await getRetry(`${server.baseUrl}/v1/models`, { headers: authHeaders('none') })
      expect(res.status).toBe(401)
    },
    TEST_TIMEOUT,
  )

  test(
    '誤ったトークン → 401',
    async () => {
      const res = await getRetry(`${server.baseUrl}/v1/models`, {
        headers: authHeaders('bearer', 'wrong-token'),
      })
      expect(res.status).toBe(401)
    },
    TEST_TIMEOUT,
  )

  test(
    'Bearer 正しい → 200',
    async () => {
      const res = await getRetry(`${server.baseUrl}/v1/models`, {
        headers: authHeaders('bearer'),
      })
      expect(res.status).toBe(200)
    },
    TEST_TIMEOUT,
  )

  test(
    'x-api-key 正しい → 200',
    async () => {
      const res = await getRetry(`${server.baseUrl}/v1/models`, {
        headers: authHeaders('apikey'),
      })
      expect(res.status).toBe(200)
    },
    TEST_TIMEOUT,
  )

  test(
    'WS ?token= 正しい → 接続成功',
    async () => {
      const s = await HumanSim.connect(server.wsUrl(server.token))
      s.close()
    },
    TEST_TIMEOUT,
  )

  test(
    'WS ?token= 誤り → 接続失敗',
    async () => {
      await expect(HumanSim.connect(server.wsUrl('wrong-token'), 5000)).rejects.toThrow()
    },
    TEST_TIMEOUT,
  )

  test(
    'HTTP の ?token= は不可(/v1/responses?token=正しい値 でも 401)',
    async () => {
      // ?token= は URL がログに残り漏洩するため /ws のみ許可。HTTP は Bearer / x-api-key のみ。
      // 未認証 POST は Worker 層で弾かれ DO に届かない(副作用ゼロ)。wrangler dev の起動直後の
      // isolate スワップで稀に一時 503 を返すため、認証拒否が確定するまで安全にリトライする。
      const url = `${server.baseUrl}/v1/responses?token=${encodeURIComponent(server.token)}`
      // 一時 503(wrangler dev の isolate スワップ)を吸収し、認証拒否(401)が確定することを検証する。
      const { res, transient } = await fetchAuthReject(url)
      expect(res.status, `expected 401; transient=${JSON.stringify(transient)}`).toBe(401)
    },
    TEST_TIMEOUT,
  )
})

// ---------- 2. ルーティング(クエリ付き) ----------

describe('ルーティング', () => {
  test(
    'POST /v1/messages?beta=true(クエリ付き)が通る',
    async () => {
      sim.reset()
      sim.onRequest((req) => sim.respond(req.requestId, 'クエリ付きでも届いた'))
      const res = await postJson('/v1/messages?beta=true', {
        model: 'human',
        messages: [{ role: 'user', content: 'テスト' }],
        stream: false,
      })
      expect(res.status).toBe(200)
      const body = asObj(await res.json())
      const content = body.content as Array<Record<string, unknown>>
      expect(content[0]?.text).toBe('クエリ付きでも届いた')
    },
    TEST_TIMEOUT,
  )
})

// ---------- 3. /v1/messages ストリーミング(thinking → final) ----------

describe('/v1/messages ストリーミング', () => {
  test(
    'thinking ブロック(dummy signature_delta で閉じる)→ text → message_stop の順',
    async () => {
      sim.reset()
      sim.onRequest((req) => {
        sim.reasoning(req.requestId, '考え中...')
        setTimeout(() => sim.respond(req.requestId, '最終回答'), 50)
      })
      const res = await postJson('/v1/messages?beta=true', {
        model: 'human',
        messages: [{ role: 'user', content: '質問' }],
        stream: true,
      })
      const events = await readSse(res)
      const types = events.map(dataType)

      expect(types[0]).toBe('message_start')
      expect(types[types.length - 1]).toBe('message_stop')

      const thinkingStart = events.findIndex(
        (e) => e.event === 'content_block_start' && asObj(e.data.content_block).type === 'thinking',
      )
      const sig = events.findIndex(
        (e) => e.event === 'content_block_delta' && asObj(e.data.delta).type === 'signature_delta',
      )
      const textStart = events.findIndex(
        (e) => e.event === 'content_block_start' && asObj(e.data.content_block).type === 'text',
      )
      const textDelta = events.findIndex(
        (e) => e.event === 'content_block_delta' && asObj(e.data.delta).type === 'text_delta',
      )
      const msgDelta = types.indexOf('message_delta')

      expect(thinkingStart).toBeGreaterThanOrEqual(0)
      expect(sig).toBeGreaterThan(thinkingStart)
      expect(textStart).toBeGreaterThan(sig)
      expect(textDelta).toBeGreaterThan(textStart)
      expect(msgDelta).toBeGreaterThan(textDelta)

      // thinking は index 0、text は index 1。
      expect(asObj(events[thinkingStart]?.data).index).toBe(0)
      expect(asObj(events[textStart]?.data).index).toBe(1)
      // 最終 message_delta の stop_reason は end_turn。
      expect(asObj(asObj(events[msgDelta]?.data).delta).stop_reason).toBe('end_turn')
    },
    TEST_TIMEOUT,
  )
})

// ---------- 4. /v1/messages 並列 tool call ----------

describe('/v1/messages 並列 tool call', () => {
  test(
    'tool_calls 2 件 → tool_use ブロック 2 個・stop_reason=tool_use',
    async () => {
      sim.reset()
      const items: ToolCallItem[] = [
        { type: 'function_call', callId: 'c1', name: 'Read', arguments: '{"path":"a.txt"}' },
        { type: 'function_call', callId: 'c2', name: 'Read', arguments: '{"path":"b.txt"}' },
      ]
      sim.onRequest((req) => sim.toolCalls(req.requestId, items))
      const res = await postJson('/v1/messages?beta=true', {
        model: 'human',
        messages: [{ role: 'user', content: '2 つ読んで' }],
        tools: [{ name: 'Read', input_schema: { type: 'object' } }],
        stream: false,
      })
      expect(res.status).toBe(200)
      const body = asObj(await res.json())
      const content = body.content as Array<Record<string, unknown>>
      expect(content).toHaveLength(2)
      expect(content.every((b) => b.type === 'tool_use')).toBe(true)
      expect(content[0]?.name).toBe('Read')
      expect(body.stop_reason).toBe('tool_use')
    },
    TEST_TIMEOUT,
  )
})

// ---------- 5. tool 結果後の継続 ----------

describe('tool 結果後の継続', () => {
  test(
    '2 ターン目に tool_result が人間へ届き、継続 thinking → final を返せる',
    async () => {
      sim.reset()
      // ターン 1: tool call を発行。
      sim.onRequest((req) =>
        sim.toolCalls(req.requestId, [
          { type: 'function_call', callId: 'call-x', name: 'Bash', arguments: '{"command":"ls"}' },
        ]),
      )
      const res1 = await postJson('/v1/messages?beta=true', {
        model: 'human',
        messages: [{ role: 'user', content: 'ディレクトリを見て' }],
        tools: [{ name: 'Bash', input_schema: { type: 'object' } }],
        stream: false,
      })
      const body1 = asObj(await res1.json())
      const toolUse = (body1.content as Array<Record<string, unknown>>)[0]
      expect(toolUse?.type).toBe('tool_use')

      // ターン 2: tool_result を含めて再送。人間に届いた messages を捕捉して検証する。
      let turn2Messages: { role: string; content: string }[] = []
      sim.onRequest((req) => {
        turn2Messages = req.messages
        sim.reasoning(req.requestId, '結果を踏まえて')
        setTimeout(() => sim.respond(req.requestId, 'file1 と file2 を確認した'), 30)
      })
      const res2 = await postJson('/v1/messages?beta=true', {
        model: 'human',
        messages: [
          { role: 'user', content: 'ディレクトリを見て' },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: toolUse?.id, name: 'Bash', input: { command: 'ls' } },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolUse?.id, content: 'file1\nfile2' }],
          },
        ],
        tools: [{ name: 'Bash', input_schema: { type: 'object' } }],
        stream: false,
      })
      expect(res2.status).toBe(200)
      const body2 = asObj(await res2.json())
      const text = (body2.content as Array<Record<string, unknown>>)[0]
      expect(text?.text).toBe('file1 と file2 を確認した')

      // messages 配列に tool 結果が含まれていること。
      const flat = turn2Messages.map((m) => m.content).join('\n')
      expect(flat).toContain('[tool_result]')
      expect(flat).toContain('file1')
    },
    TEST_TIMEOUT,
  )
})

// ---------- 6. /v1/responses ----------

describe('/v1/responses', () => {
  test(
    'reasoning summary(streaming): reasoning → 本文',
    async () => {
      sim.reset()
      sim.onRequest((req) => {
        sim.reasoning(req.requestId, '**見出し**\n熟考中')
        setTimeout(() => sim.respond(req.requestId, 'これが答え'), 40)
      })
      const res = await postJson('/v1/responses', {
        model: 'human',
        input: '難問',
        stream: true,
      })
      const events = await readSse(res)
      const types = events.map(dataType)

      expect(types).toContain('response.reasoning_summary_text.delta')
      // reasoning アイテムが output_index 0 で追加される。
      const reasoningAdded = events.find(
        (e) => e.event === 'response.output_item.added' && asObj(e.data.item).type === 'reasoning',
      )
      expect(reasoningAdded).toBeDefined()

      const completed = events.find((e) => e.event === 'response.completed')
      const output = asObj(asObj(completed?.data).response).output as Array<Record<string, unknown>>
      expect(output.some((o) => o.type === 'reasoning')).toBe(true)
      expect(output.some((o) => o.type === 'message')).toBe(true)
    },
    TEST_TIMEOUT,
  )

  test(
    'function_call + local_shell_call の並列複数(非ストリーム)',
    async () => {
      sim.reset()
      const items: ToolCallItem[] = [
        {
          type: 'function_call',
          callId: 'fc1',
          name: 'get_weather',
          arguments: '{"city":"tokyo"}',
        },
        {
          type: 'local_shell_call',
          callId: 'ls1',
          command: ['bash', '-lc', 'echo hi'],
          workingDirectory: null,
        },
      ]
      sim.onRequest((req) => sim.toolCalls(req.requestId, items))
      const res = await postJson('/v1/responses', {
        model: 'human',
        input: 'ツールを 2 つ',
        tools: [{ type: 'function', name: 'get_weather' }],
        stream: false,
      })
      expect(res.status).toBe(200)
      const body = asObj(await res.json())
      const output = body.output as Array<Record<string, unknown>>
      expect(output).toHaveLength(2)
      expect(output.some((o) => o.type === 'function_call')).toBe(true)
      expect(output.some((o) => o.type === 'local_shell_call')).toBe(true)
    },
    TEST_TIMEOUT,
  )
})

// ---------- 7. 裏方リクエスト自動応答(人間へ届かない) ----------

describe('裏方リクエスト自動応答', () => {
  test(
    'Claude セッションタイトル生成は即応答し WS に届かない',
    async () => {
      sim.reset()
      const res = await postJson('/v1/messages?beta=true', {
        model: 'human',
        messages: [
          { role: 'user', content: '<session>会話ログ</session>\nWrite the title of this session' },
        ],
        stream: false,
      })
      expect(res.status).toBe(200)
      const body = asObj(await res.json())
      const content = body.content as Array<Record<string, unknown>>
      expect(content[0]?.text).toBe('人間LLM劇場')
      await sim.expectNone('request', 400)
    },
    TEST_TIMEOUT,
  )

  test(
    '[SUGGESTION MODE は即応答し WS に届かない',
    async () => {
      sim.reset()
      const res = await postJson('/v1/messages?beta=true', {
        model: 'human',
        messages: [{ role: 'user', content: '[SUGGESTION MODE] give hints' }],
        stream: false,
      })
      expect(res.status).toBe(200)
      await sim.expectNone('request', 400)
    },
    TEST_TIMEOUT,
  )

  test(
    'codex メモリ生成(Analyze this rollout + rollout_slug)は即応答し WS に届かない',
    async () => {
      sim.reset()
      const res = await postJson('/v1/responses', {
        model: 'human',
        input: 'Analyze this rollout and produce a rollout_slug',
        stream: false,
      })
      expect(res.status).toBe(200)
      const body = asObj(await res.json())
      const output = body.output as Array<Record<string, unknown>>
      const content = asObj(output[0]).content as Array<Record<string, unknown>>
      const parsed = asObj(JSON.parse(String(content[0]?.text)))
      expect(parsed).toHaveProperty('rollout_slug')
      await sim.expectNone('request', 400)
    },
    TEST_TIMEOUT,
  )
})

// ---------- 8. WS 観測イベント ----------

describe('WS 観測イベント', () => {
  test(
    'thought / answered が request 処理に伴い配信される',
    async () => {
      sim.reset()
      sim.onRequest((req) => {
        sim.reasoning(req.requestId, '思考の断片')
        setTimeout(() => sim.respond(req.requestId, '確定回答'), 40)
      })
      const res = await postJson('/v1/messages?beta=true', {
        model: 'human',
        messages: [{ role: 'user', content: '観測テスト' }],
        stream: false,
      })
      await res.json()
      const thought = await sim.waitFor('thought', (m) => m.content.includes('思考の断片'))
      expect(thought.type).toBe('thought')
      const answered = await sim.waitFor('answered', (m) => m.content === '確定回答')
      expect(answered.type).toBe('answered')
    },
    TEST_TIMEOUT,
  )

  test(
    'tool_called が items 配列で配信される',
    async () => {
      sim.reset()
      const items: ToolCallItem[] = [
        { type: 'function_call', callId: 'tc1', name: 'Grep', arguments: '{"q":"x"}' },
        { type: 'function_call', callId: 'tc2', name: 'Grep', arguments: '{"q":"y"}' },
      ]
      sim.onRequest((req) => sim.toolCalls(req.requestId, items))
      const res = await postJson('/v1/messages?beta=true', {
        model: 'human',
        messages: [{ role: 'user', content: 'tool 観測' }],
        tools: [{ name: 'Grep', input_schema: { type: 'object' } }],
        stream: false,
      })
      await res.json()
      const called = await sim.waitFor('tool_called', (m) => m.items.length === 2)
      expect(called.items).toHaveLength(2)
      expect(called.items[0]?.type).toBe('function_call')
    },
    TEST_TIMEOUT,
  )
})

// ---------- 9. Runs API ----------

describe('Runs API', () => {
  test(
    'run 作成 → rollout 作成 → 採点([SCORE]) → 永続化確認・score WS 配信',
    async () => {
      // run 作成
      const runRes = await postJson('/api/runs', { title: 'テスト run' })
      expect(runRes.status).toBe(201)
      const runId = String(asObj(asObj(await runRes.json()).run).id)
      expect(runId).toBeTruthy()

      // rollout 作成
      const rolloutRes = await postJson(`/api/runs/${runId}/rollouts`, { task: '設計課題' })
      expect(rolloutRes.status).toBe(201)
      const rollout = asObj(asObj(await rolloutRes.json()).rollout)
      const rolloutId = String(rollout.id)
      expect(rollout.runId).toBe(runId)

      // 採点([SCORE: 7.5/10])
      sim.reset()
      const scoreRes = await postJson(`/api/rollouts/${rolloutId}/score`, {
        text: 'よい設計だ。[SCORE: 7.5/10]',
      })
      expect(scoreRes.status).toBe(200)
      const scored = asObj(asObj(await scoreRes.json()).rollout)
      const score = asObj(scored.score)
      expect(score.value).toBe(7.5)
      expect(score.max).toBe(10)

      // score WS イベント配信
      const wsScore = await sim.waitFor('score', (m) => m.rolloutId === rolloutId)
      expect(wsScore.score.value).toBe(7.5)

      // 永続化確認(GET)
      const getRes = await getRetry(`${server.baseUrl}/api/rollouts/${rolloutId}`, {
        headers: authHeaders('bearer'),
      })
      const persisted = asObj(asObj(await getRes.json()).rollout)
      expect(asObj(persisted.score).value).toBe(7.5)

      // run 取得で rollout が紐づく
      const runGet = await getRetry(`${server.baseUrl}/api/runs/${runId}`, {
        headers: authHeaders('bearer'),
      })
      const runBody = asObj(await runGet.json())
      const rolloutIds = asObj(runBody.run).rolloutIds as string[]
      expect(rolloutIds).toContain(rolloutId)
    },
    TEST_TIMEOUT,
  )

  test(
    'タグ無しの採点は 4xx(422)',
    async () => {
      const runRes = await postJson('/api/runs', { title: 'タグ無し run' })
      const runId = String(asObj(asObj(await runRes.json()).run).id)
      const rolloutRes = await postJson(`/api/runs/${runId}/rollouts`, { task: 'x' })
      const rolloutId = String(asObj(asObj(await rolloutRes.json()).rollout).id)

      const scoreRes = await postJson(`/api/rollouts/${rolloutId}/score`, {
        text: '採点タグを忘れた講評',
      })
      expect(scoreRes.status).toBeGreaterThanOrEqual(400)
      expect(scoreRes.status).toBeLessThan(500)
    },
    TEST_TIMEOUT,
  )

  test(
    '{value,max} 直接指定の不変条件違反({value:-5, max:1})は 422',
    async () => {
      const runRes = await postJson('/api/runs', { title: '不変条件 run' })
      const runId = String(asObj(asObj(await runRes.json()).run).id)
      const rolloutRes = await postJson(`/api/runs/${runId}/rollouts`, { task: 'x' })
      const rolloutId = String(asObj(asObj(await rolloutRes.json()).rollout).id)

      // max!==10 かつ value<0 の二重違反。スケールは /10 固定・0<=value<=10。
      const scoreRes = await postJson(`/api/rollouts/${rolloutId}/score`, { value: -5, max: 1 })
      expect(scoreRes.status).toBe(422)
    },
    TEST_TIMEOUT,
  )
})

// ---------- 10. タイムアウトと再武装(短い HUMAN_TIMEOUT_MS を注入) ----------
//
// 実 30 分は待てないので、HUMAN_TIMEOUT_MS を短く(T=3000ms)注入した
// 独立インスタンスを別ポートに立てて検証する。既定の共有スイート(30 分)には影響しない。

describe('タイムアウトと再武装', () => {
  const T = 3000
  let ts: ServerHandle
  let tsim: HumanSim

  // mutating な POST は再試行しない(素の fetch)。リロード窓は beforeAll の priming で吸収する。
  const tPost = (path: string, body: unknown): Promise<Response> =>
    fetch(`${ts.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ts.token}` },
      body: JSON.stringify(body),
    })

  beforeAll(async () => {
    ts = await startWranglerInstance({
      port: 8798,
      inspectorPort: 9798,
      vars: { HUMAN_TIMEOUT_MS: String(T) },
    })
    tsim = await HumanSim.connect(ts.wsUrl(ts.token))
    // prime: 人間往復で worker をリロード窓の先まで温める(priming は使い捨てなので 503 リトライ可)。
    await primeRoundTrip(ts, tsim)
  }, 90_000)

  afterAll(async () => {
    tsim?.close()
    await ts?.stop()
  })

  test('A: 人間無反応 → messages 非ストリームが 400 timeout_error を返し WS に timeout 配信', async () => {
    tsim.reset()
    let reqId = ''
    // 応答しない(requestId だけ捕捉する)。
    tsim.onRequest((req) => {
      reqId = req.requestId
    })
    const start = Date.now()
    const res = await tPost('/v1/messages', {
      model: 'human',
      messages: [{ role: 'user', content: '無反応テスト' }],
      stream: false,
    })
    const body = asObj(await res.json())
    const elapsed = Date.now() - start
    // タイムアウトは非再試行の 400 + Anthropic 形式 timeout_error(生 500 は SDK に二重出題される)。
    expect(res.status).toBe(400)
    expect(body.type).toBe('error')
    expect(asObj(body.error).type).toBe('timeout_error')
    // 概ね T 経過している(素の待機が効いていることの傍証)。
    expect(elapsed).toBeGreaterThanOrEqual(T * 0.7)
    // WS に timeout イベントが同じ requestId で配信される。
    const ev = await tsim.waitFor('timeout', (m) => m.requestId === reqId, 4000)
    expect(ev.type).toBe('timeout')
  }, 20_000)

  test('A: 人間無反応 → responses 非ストリームも 400 timeout_error + WS timeout', async () => {
    tsim.reset()
    let reqId = ''
    tsim.onRequest((req) => {
      reqId = req.requestId
    })
    const res = await tPost('/v1/responses', {
      model: 'human',
      input: '無反応テスト(codex)',
      stream: false,
    })
    const body = asObj(await res.json())
    // OpenAI 形式 timeout_error。
    expect(res.status).toBe(400)
    expect(asObj(body.error).type).toBe('timeout_error')
    const ev = await tsim.waitFor('timeout', (m) => m.requestId === reqId, 4000)
    expect(ev.type).toBe('timeout')
  }, 20_000)

  test('A(stream): messages ストリームは event: error 送出後にクローズ(message_stop なし)', async () => {
    tsim.reset()
    let reqId = ''
    tsim.onRequest((req) => {
      reqId = req.requestId
    })
    const res = await tPost('/v1/messages', {
      model: 'human',
      messages: [{ role: 'user', content: '無反応ストリーム' }],
      stream: true,
    })
    expect(res.status).toBe(200)
    const events = await readSse(res)
    const types = events.map(dataType)
    // 終端は error イベント。正常終了(message_stop)は来ない。
    expect(types).toContain('error')
    expect(types).not.toContain('message_stop')
    const errEvent = events.find((e) => e.event === 'error')
    expect(asObj(asObj(errEvent?.data).error).type).toBe('timeout_error')
    const ev = await tsim.waitFor('timeout', (m) => m.requestId === reqId, 4000)
    expect(ev.type).toBe('timeout')
  }, 20_000)

  // codex は response.failed を retryable と解釈して再送→二重出題するため、responses ストリームの
  // タイムアウトは「正常終了マスキング」に変更された: reasoning/message を正しく閉じ、
  // [human-1] timeout: 告知を output_text に載せ、response.completed(status:"completed")で終端する。
  test('A(stream): responses ストリームは response.completed でマスクして終端(failed 無し)', async () => {
    tsim.reset()
    let reqId = ''
    tsim.onRequest((req) => {
      reqId = req.requestId
    })
    const res = await tPost('/v1/responses', {
      model: 'human',
      input: '無反応ストリーム(codex)',
      stream: true,
    })
    expect(res.status).toBe(200)
    const events = await readSse(res)
    const types = events.map(dataType)
    // response.failed は現れず、response.completed(status:"completed")で終端する。
    expect(types).not.toContain('response.failed')
    expect(types).toContain('response.completed')
    const completed = events.find((e) => e.event === 'response.completed')
    const resp = asObj(asObj(completed?.data).response)
    expect(resp.status).toBe('completed')
    // message アイテムに [human-1] timeout: 告知が含まれる。
    const output = resp.output as Array<Record<string, unknown>>
    const message = output.find((o) => o.type === 'message')
    const text = String(asObj((asObj(message).content as Array<Record<string, unknown>>)[0]).text)
    expect(text).toContain('[human-1] timeout:')
    // WS timeout は維持される。
    const ev = await tsim.waitFor('timeout', (m) => m.requestId === reqId, 4000)
    expect(ev.type).toBe('timeout')
  }, 20_000)

  test('A(stream合成): responses は途中テキスト + timeout 告知を載せて completed で終端', async () => {
    tsim.reset()
    let reqId = ''
    // 途中まで delta を出してから沈黙 → タイムアウト。告知は既存テキストに \n\n で追記される。
    tsim.onRequest((req) => {
      reqId = req.requestId
      tsim.delta(req.requestId, '途中まで書いた回答')
    })
    const res = await tPost('/v1/responses', {
      model: 'human',
      input: 'delta 途中でタイムアウト(codex)',
      stream: true,
    })
    expect(res.status).toBe(200)
    const events = await readSse(res)
    const types = events.map(dataType)
    expect(types).not.toContain('response.failed')
    expect(types).toContain('response.completed')
    const completed = events.find((e) => e.event === 'response.completed')
    const resp = asObj(asObj(completed?.data).response)
    expect(resp.status).toBe('completed')
    const output = resp.output as Array<Record<string, unknown>>
    const message = output.find((o) => o.type === 'message')
    const text = String(asObj((asObj(message).content as Array<Record<string, unknown>>)[0]).text)
    // 途中テキストと告知の両方が最終 output に載る。
    expect(text).toContain('途中まで書いた回答')
    expect(text).toContain('[human-1] timeout:')
    const ev = await tsim.waitFor('timeout', (m) => m.requestId === reqId, 5000)
    expect(ev.type).toBe('timeout')
  }, 20_000)

  test('B: 再武装 — 0.7T で reasoning、1.4T で final を送ると素のタイムアウト超過でも正常完了', async () => {
    tsim.reset()
    // reasoning を 0.7T(素のタイムアウト前)に送って再武装し、
    // final を 1.4T(素のタイムアウトなら死んでいる時刻)に送る。
    tsim.onRequest((req) => {
      setTimeout(() => tsim.reasoning(req.requestId, '生きてます(再武装)'), T * 0.7)
      setTimeout(() => tsim.respond(req.requestId, '再武装後の最終回答'), T * 1.4)
    })
    const start = Date.now()
    const res = await tPost('/v1/messages', {
      model: 'human',
      messages: [{ role: 'user', content: '再武装テスト' }],
      stream: true,
    })
    expect(res.status).toBe(200)
    const events = await readSse(res)
    const elapsed = Date.now() - start
    const types = events.map(dataType)

    // 素のタイムアウト(T)を超えて完了している。
    expect(elapsed).toBeGreaterThan(T)
    // 正常終了(message_stop)しており、最終テキストが届いている。
    expect(types[types.length - 1]).toBe('message_stop')
    const textDelta = events.find(
      (e) => e.event === 'content_block_delta' && asObj(e.data.delta).type === 'text_delta',
    )
    expect(String(asObj(asObj(textDelta?.data).delta).text)).toContain('再武装後の最終回答')
    // タイムアウトは配信されていない。
    expect(tsim.received.some((m) => m.type === 'timeout')).toBe(false)
  }, 20_000)
})

// ---------- 回帰: delta → tool_calls の SSE 構造 ----------

describe('delta → tool_calls の SSE 構造', () => {
  test(
    'messages: 途中 text ブロックを閉じてから tool_use・全ブロック閉鎖',
    async () => {
      sim.reset()
      sim.onRequest((req) => {
        sim.delta(req.requestId, '調べます。')
        setTimeout(
          () =>
            sim.toolCalls(req.requestId, [
              { type: 'function_call', callId: 'd1', name: 'Bash', arguments: '{"command":"ls"}' },
            ]),
          40,
        )
      })
      const res = await postJson('/v1/messages?beta=true', {
        model: 'human',
        messages: [{ role: 'user', content: 'delta then tool' }],
        tools: [{ name: 'Bash', input_schema: { type: 'object' } }],
        stream: true,
      })
      const events = await readSse(res)

      // text ブロックの stop が tool_use の start より前。
      const textStart = events.findIndex(
        (e) => e.event === 'content_block_start' && asObj(e.data.content_block).type === 'text',
      )
      const textStop = events.findIndex((e, i) => e.event === 'content_block_stop' && i > textStart)
      const toolStart = events.findIndex(
        (e) => e.event === 'content_block_start' && asObj(e.data.content_block).type === 'tool_use',
      )
      expect(textStart).toBeGreaterThanOrEqual(0)
      expect(toolStart).toBeGreaterThan(textStop)
      expect(textStop).toBeGreaterThan(textStart)

      // 全 content_block_start に対応する content_block_stop があり index が一致する(未閉鎖ブロック無し)。
      const starts = events.filter((e) => e.event === 'content_block_start')
      const stops = events.filter((e) => e.event === 'content_block_stop')
      expect(stops.length).toBe(starts.length)
      const startIdx = starts.map((e) => asObj(e.data).index).sort()
      const stopIdx = stops.map((e) => asObj(e.data).index).sort()
      expect(stopIdx).toEqual(startIdx)

      // 終端は tool_use。
      const msgDelta = events.find((e) => e.event === 'message_delta')
      expect(asObj(asObj(msgDelta?.data).delta).stop_reason).toBe('tool_use')
    },
    TEST_TIMEOUT,
  )

  test(
    'responses: 途中テキストが最終 output に残り output_index が衝突しない',
    async () => {
      sim.reset()
      sim.onRequest((req) => {
        sim.delta(req.requestId, '途中経過テキスト')
        setTimeout(
          () =>
            sim.toolCalls(req.requestId, [
              { type: 'function_call', callId: 'r1', name: 'get_x', arguments: '{"a":1}' },
            ]),
          40,
        )
      })
      const res = await postJson('/v1/responses', {
        model: 'human',
        input: 'delta then tool (codex)',
        tools: [{ type: 'function', name: 'get_x' }],
        stream: true,
      })
      const events = await readSse(res)

      const completed = events.find((e) => e.event === 'response.completed')
      const output = asObj(asObj(completed?.data).response).output as Array<Record<string, unknown>>
      // message(途中テキスト込み)と function_call の両方が最終 output に含まれる。
      const message = output.find((o) => o.type === 'message')
      const fnCall = output.find((o) => o.type === 'function_call')
      expect(message).toBeDefined()
      expect(fnCall).toBeDefined()
      const msgText = asObj((asObj(message).content as Array<Record<string, unknown>>)[0]).text
      expect(String(msgText)).toContain('途中経過テキスト')

      // output_item.added の output_index に重複が無い(index 衝突なし)。
      const addedIdx = events
        .filter((e) => e.event === 'response.output_item.added')
        .map((e) => asObj(e.data).output_index)
      expect(new Set(addedIdx).size).toBe(addedIdx.length)
      // message の output_text.done が中間テキストで確定している。
      const textDone = events.find((e) => e.event === 'response.output_text.done')
      expect(String(asObj(textDone?.data).text)).toContain('途中経過テキスト')
    },
    TEST_TIMEOUT,
  )
})

// ---------- 回帰: 不正ボディ 400(両プロトコル) ----------

describe('不正ボディ 400', () => {
  // 不正ボディは即 400 を返すので再試行不要(素の fetch)。
  const postRaw = (path: string, raw: string): Promise<Response> =>
    fetch(`${server.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders('bearer') },
      body: raw,
    })

  test(
    'messages: 壊れ JSON → 400 invalid_request_error',
    async () => {
      const res = await postRaw('/v1/messages?beta=true', '{ this is not json ')
      expect(res.status).toBe(400)
      const body = asObj(await res.json())
      expect(body.type).toBe('error')
      expect(asObj(body.error).type).toBe('invalid_request_error')
    },
    TEST_TIMEOUT,
  )

  test(
    'messages: messages フィールド欠落/型違い → 400 invalid_request_error',
    async () => {
      const res = await postRaw('/v1/messages?beta=true', JSON.stringify({ model: 'human' }))
      expect(res.status).toBe(400)
      const body = asObj(await res.json())
      expect(asObj(body.error).type).toBe('invalid_request_error')
    },
    TEST_TIMEOUT,
  )

  test(
    'responses: 壊れ JSON → 400 invalid_request_error',
    async () => {
      const res = await postRaw('/v1/responses', 'not json at all')
      expect(res.status).toBe(400)
      const body = asObj(await res.json())
      expect(asObj(body.error).type).toBe('invalid_request_error')
    },
    TEST_TIMEOUT,
  )

  test(
    'responses: input フィールド欠落 → 400 invalid_request_error',
    async () => {
      const res = await postRaw('/v1/responses', JSON.stringify({ model: 'human' }))
      expect(res.status).toBe(400)
      const body = asObj(await res.json())
      expect(asObj(body.error).type).toBe('invalid_request_error')
    },
    TEST_TIMEOUT,
  )
})

// ---------- 回帰: WS 再接続で pending スナップショット再送 ----------

describe('WS 再接続で pending スナップショット再送', () => {
  test('1台目で request 受信 → 切断 → 2台目接続で同 requestId が届き回答で SSE 完了', async () => {
    // 既定 sim は応答しないようにする(初回 broadcast で誤答させない)。
    sim.reset()

    const sim1 = await HumanSim.connect(server.wsUrl(server.token))
    let reqId = ''
    sim1.onRequest((req) => {
      reqId = req.requestId
    })

    // ストリームリクエストを投げ、pending を in-flight にしたまま SSE を裏で読む。
    const res = await postJson('/v1/messages?beta=true', {
      model: 'human',
      messages: [{ role: 'user', content: '再接続テスト' }],
      stream: true,
    })
    expect(res.status).toBe(200)
    const ssePromise = readSse(res)

    // 1 台目が request を受信(まだ回答しない)。
    const req1 = await sim1.waitFor('request', () => true, 8000)
    expect(req1.requestId).toBeTruthy()
    reqId = req1.requestId

    // 1 台目を切断 → 2 台目を接続。接続時に in-flight pending のスナップショットが再送される。
    sim1.close()
    const sim2 = await HumanSim.connect(server.wsUrl(server.token))
    const req2 = await sim2.waitFor('request', (m) => m.requestId === reqId, 8000)
    expect(req2.requestId).toBe(reqId)

    // 2 台目から回答 → SSE が正常完了する。
    sim2.respond(reqId, '再接続後に回答した')
    const events = await ssePromise
    const types = events.map(dataType)
    expect(types[types.length - 1]).toBe('message_stop')
    const textDelta = events.find(
      (e) => e.event === 'content_block_delta' && asObj(e.data.delta).type === 'text_delta',
    )
    expect(String(asObj(asObj(textDelta?.data).delta).text)).toContain('再接続後に回答した')
    sim2.close()
  }, 30_000)
})

// ---------- 11. 非ストリーミング(両プロトコル) ----------

describe('非ストリーミング', () => {
  test(
    '/v1/messages stream:false → JSON message',
    async () => {
      sim.reset()
      sim.onRequest((req) => sim.respond(req.requestId, 'ブロッキング回答'))
      const res = await postJson('/v1/messages?beta=true', {
        model: 'human',
        messages: [{ role: 'user', content: 'q' }],
        stream: false,
      })
      expect(res.status).toBe(200)
      const body = asObj(await res.json())
      expect(body.type).toBe('message')
      expect((body.content as Array<Record<string, unknown>>)[0]?.text).toBe('ブロッキング回答')
      expect(body.stop_reason).toBe('end_turn')
    },
    TEST_TIMEOUT,
  )

  test(
    '/v1/responses stream:false → JSON response',
    async () => {
      sim.reset()
      sim.onRequest((req) => sim.respond(req.requestId, 'codex 向け回答'))
      const res = await postJson('/v1/responses', {
        model: 'human',
        input: 'q',
        stream: false,
      })
      expect(res.status).toBe(200)
      const body = asObj(await res.json())
      expect(body.object).toBe('response')
      const output = body.output as Array<Record<string, unknown>>
      const content = asObj(output[0]).content as Array<Record<string, unknown>>
      expect(content[0]?.text).toBe('codex 向け回答')
    },
    TEST_TIMEOUT,
  )
})
