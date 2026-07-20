import { extractScore, type Score } from '@human-1/shared'
import type { HumanLlmDO } from './do'
import { json } from './http'

// 訓練 run / rollout / score の最小 REST API(認証は Worker 側で済み)。
//   GET  /api/runs                     一覧
//   POST /api/runs                     { title } で作成
//   GET  /api/runs/:id                 単体 + rollout 一覧
//   POST /api/runs/:id/rollouts        { task } で rollout 作成
//   GET  /api/rollouts/:id             rollout 単体
//   POST /api/rollouts/:id/score       { text } で採点抽出、または { value, max, comment } 直接指定
//   POST /api/rollouts/:id/end         score なしで rollout を終了(タイムアウト/失敗の終端記録)
export async function handleApi(
  ctx: HumanLlmDO,
  request: Request,
  path: string,
): Promise<Response> {
  const method = request.method

  if (path === '/api/runs') {
    if (method === 'GET') return json({ runs: ctx.listRuns() })
    if (method === 'POST') {
      const body = await readJson(request)
      const title = typeof body.title === 'string' ? body.title : 'untitled run'
      return json({ run: ctx.createRun(title) }, 201)
    }
    return json({ error: { message: 'method not allowed' } }, 405)
  }

  const runRollouts = path.match(/^\/api\/runs\/([^/]+)\/rollouts$/)
  if (runRollouts) {
    const runId = decodeURIComponent(runRollouts[1] as string)
    if (method !== 'POST') return json({ error: { message: 'method not allowed' } }, 405)
    const body = await readJson(request)
    const task = typeof body.task === 'string' ? body.task : ''
    const rollout = ctx.createRollout(runId, task)
    if (!rollout) return json({ error: { message: 'run not found' } }, 404)
    return json({ rollout }, 201)
  }

  const runOne = path.match(/^\/api\/runs\/([^/]+)$/)
  if (runOne) {
    const runId = decodeURIComponent(runOne[1] as string)
    if (method !== 'GET') return json({ error: { message: 'method not allowed' } }, 405)
    const run = ctx.getRun(runId)
    if (!run) return json({ error: { message: 'run not found' } }, 404)
    const rollouts = run.rolloutIds.map((id) => ctx.getRollout(id)).filter((r) => r !== null)
    return json({ run, rollouts })
  }

  const rolloutScore = path.match(/^\/api\/rollouts\/([^/]+)\/score$/)
  if (rolloutScore) {
    const rolloutId = decodeURIComponent(rolloutScore[1] as string)
    if (method !== 'POST') return json({ error: { message: 'method not allowed' } }, 405)
    const body = await readJson(request)
    const score = buildScore(body)
    if (!score)
      return json(
        { error: { message: 'no valid [SCORE: x.x/10] tag or {value,max} provided' } },
        422,
      )
    const rollout = ctx.setScore(rolloutId, score)
    if (!rollout) return json({ error: { message: 'rollout not found' } }, 404)
    // 学習曲線として観測者へ配信する。
    ctx.broadcast({ type: 'score', rolloutId, score })
    return json({ rollout })
  }

  const rolloutEnd = path.match(/^\/api\/rollouts\/([^/]+)\/end$/)
  if (rolloutEnd) {
    const rolloutId = decodeURIComponent(rolloutEnd[1] as string)
    if (method !== 'POST') return json({ error: { message: 'method not allowed' } }, 405)
    const rollout = ctx.endRollout(rolloutId, Date.now())
    if (!rollout) return json({ error: { message: 'rollout not found' } }, 404)
    return json({ rollout })
  }

  const rolloutOne = path.match(/^\/api\/rollouts\/([^/]+)$/)
  if (rolloutOne) {
    const rolloutId = decodeURIComponent(rolloutOne[1] as string)
    if (method !== 'GET') return json({ error: { message: 'method not allowed' } }, 405)
    const rollout = ctx.getRollout(rolloutId)
    if (!rollout) return json({ error: { message: 'rollout not found' } }, 404)
    return json({ rollout })
  }

  return json({ error: { message: 'not found' } }, 404)
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

// スケールは /10 固定・0..10。extractScore と同じ不変条件を直接指定経路にも課す。
function validScore(value: number, max: number): boolean {
  return Number.isFinite(value) && max === 10 && value >= 0 && value <= 10
}

// { text } があれば shared の extractScore で採点タグを抽出。無ければ { value, max, comment } 直接指定。
// どちらの経路でも不変条件(有限値・max===10・0<=value<=10)を満たさなければ null(→ 422)。
function buildScore(body: Record<string, unknown>): Score | null {
  const at = Date.now()
  const comment = typeof body.comment === 'string' ? body.comment : undefined
  if (typeof body.text === 'string') {
    const extracted = extractScore(body.text)
    if (!extracted) return null
    return { value: extracted.value, max: extracted.max, at, ...(comment ? { comment } : {}) }
  }
  if (typeof body.value === 'number' && typeof body.max === 'number') {
    if (!validScore(body.value, body.max)) return null
    return { value: body.value, max: body.max, at, ...(comment ? { comment } : {}) }
  }
  return null
}
