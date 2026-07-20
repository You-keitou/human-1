// 訓練 run / rollout / score の REST クライアント(server/src/runs.ts に対応)。
// 認証は Bearer トークン。サーバー URL は末尾スラッシュ無しの正規化済みを渡す。

import type { Rollout, Score, TrainingRun } from '@human-1/shared'
import type { Config } from './config'

async function req<T>(config: Config, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.server}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${config.token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  }
  return (text ? JSON.parse(text) : {}) as T
}

// 疎通確認: GET /v1/models が human モデルを返せば OK。
export async function ping(config: Config): Promise<string[]> {
  const res = await fetch(`${config.server}/v1/models`, {
    headers: { authorization: `Bearer ${config.token}` },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`GET /v1/models -> ${res.status}: ${text.slice(0, 200)}`)
  const body = JSON.parse(text) as { data?: { id: string }[] }
  return (body.data ?? []).map((m) => m.id)
}

export async function createRun(config: Config, title: string): Promise<TrainingRun> {
  const { run } = await req<{ run: TrainingRun }>(config, 'POST', '/api/runs', { title })
  return run
}

export async function createRollout(config: Config, runId: string, task: string): Promise<Rollout> {
  const { rollout } = await req<{ rollout: Rollout }>(
    config,
    'POST',
    `/api/runs/${encodeURIComponent(runId)}/rollouts`,
    { task },
  )
  return rollout
}

// トレーナーの出力全文を渡し、サーバー側で [SCORE: x.x/10] を抽出させる。
export async function scoreFromText(
  config: Config,
  rolloutId: string,
  text: string,
  comment?: string,
): Promise<Rollout> {
  const { rollout } = await req<{ rollout: Rollout }>(
    config,
    'POST',
    `/api/rollouts/${encodeURIComponent(rolloutId)}/score`,
    comment ? { text, comment } : { text },
  )
  return rollout
}

// score を付けずに rollout を終了する(タイムアウト/失敗した rollout の終端記録)。
export async function endRollout(config: Config, rolloutId: string): Promise<Rollout> {
  const { rollout } = await req<{ rollout: Rollout }>(
    config,
    'POST',
    `/api/rollouts/${encodeURIComponent(rolloutId)}/end`,
    {},
  )
  return rollout
}

export type { Rollout, Score, TrainingRun }
