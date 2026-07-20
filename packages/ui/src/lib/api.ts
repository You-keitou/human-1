import type { Rollout, TrainingRun } from '@human-1/shared'
import { authHeaders } from './auth'

// 訓練 run / rollout / score の REST 取得(認証ヘッダ付き)。server/src/runs.ts に対応。

export type RunListResponse = { runs: TrainingRun[] }
export type RunDetailResponse = { run: TrainingRun; rollouts: Rollout[] }

async function get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return (await res.json()) as T
}

export function fetchRuns(token: string): Promise<RunListResponse> {
  return get<RunListResponse>('/api/runs', token)
}

export function fetchRun(id: string, token: string): Promise<RunDetailResponse> {
  return get<RunDetailResponse>(`/api/runs/${encodeURIComponent(id)}`, token)
}
