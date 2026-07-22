import type { Rollout, TrainingRun } from '@human-1/shared'
import type { RunsFixture } from '../fixtures/runs'

// DO の TrainingRun / Rollout / Score を Runs 画面(fixture と同形)へ写す。
// 未マップのリッチ項目(rubric v2 の重み等)は実データから導出できる範囲で埋める。

function relTime(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function scores(rollouts: Rollout[]): number[] {
  return rollouts.filter((r) => r.score).map((r) => (r.score as { value: number }).value)
}

function avg(vals: number[]): number {
  if (vals.length === 0) return 0
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

// bar 高さ = 値 × 正規化(spark は最大 20.4px 相当、curve は 150px コンテナで値×15)。
function sparkBars(vals: number[]): number[] {
  return vals.map((v) => Math.max(2, (v / 10) * 20.4))
}

export type RunDetailData = { run: TrainingRun; rollouts: Rollout[] }

export function buildRunsView(
  runs: TrainingRun[],
  details: Map<string, RunDetailData>,
  selectedRunId: string | null,
  now: number = Date.now(),
): RunsFixture {
  const list: RunsFixture['list'] = runs.map((run) => {
    const d = details.get(run.id)
    const vals = d ? scores(d.rollouts) : []
    const a = avg(vals)
    const dot: 'accent' | 'tool' | 'warn' =
      run.id === selectedRunId ? 'accent' : a < 5 ? 'warn' : 'tool'
    return {
      id: run.id,
      title: run.title,
      meta: `${run.rolloutIds.length} rollouts · ${relTime(run.createdAt, now)}`,
      avg: vals.length ? a.toFixed(1) : '—',
      dot,
      bars: sparkBars(vals),
      selected: run.id === selectedRunId,
    }
  })

  const selected = selectedRunId ? details.get(selectedRunId) : undefined
  const allVals = runs.flatMap((r) =>
    details.get(r.id) ? scores(details.get(r.id)!.rollouts) : [],
  )
  const globalAvg = avg(allVals)

  const detail = buildDetail(selected, globalAvg)

  return {
    header: {
      epoch: selected?.rollouts.length ?? 0,
      avg: globalAvg ? globalAvg.toFixed(1) : '0.0',
    },
    list,
    detail,
  }
}

function buildDetail(
  selected: RunDetailData | undefined,
  globalAvg: number,
): RunsFixture['detail'] {
  if (!selected) {
    return {
      tag: 'run',
      title: 'run 未選択',
      meta: 'ロールアウトがありません',
      growth: '—',
      currentScore: '0.0',
      curve: [],
      tiles: [],
      rolloutMeta: '',
      rollout: [],
      rubricTrainer: 'claude -p',
      rubric: [],
      total: '—',
    }
  }
  const { run, rollouts } = selected
  const scored = rollouts.filter((r) => r.score)
  const vals = scores(rollouts)
  const a = avg(vals)
  const first = vals[0] ?? 0
  const last = vals[vals.length - 1] ?? 0
  const best = vals.length ? Math.max(...vals) : 0
  const growth = vals.length
    ? `${last - first >= 0 ? '+' : ''}${(last - first).toFixed(1)} growth ↗`
    : '—'

  const curve = scored.map((r, i) => {
    const v = (r.score as { value: number }).value
    return {
      label: `#${i + 1}`,
      value: v.toFixed(1),
      bold: i === scored.length - 1,
      height: Math.min(150, v * 15),
    }
  })

  const rollout: RunsFixture['detail']['rollout'] = rollouts.slice(-6).map((r, i, arr) => ({
    turn: `roll ${i + 1}`,
    chips: [{ kind: 'final', label: r.score ? 'scored' : r.endedAt ? 'ended' : 'open' }],
    score: r.score ? (r.score as { value: number }).value.toFixed(1) : '—',
    selected: i === arr.length - 1,
  }))

  const rubric = scored.slice(-4).map((r, i) => {
    const sc = r.score as { value: number; max: number; comment?: string }
    return {
      name: `rollout ${i + 1}`,
      score: `[SCORE: ${sc.value.toFixed(1)}/${sc.max}]`,
      desc: sc.comment ?? '(コメントなし)',
    }
  })

  return {
    tag: `run ${run.id.slice(0, 6)}`,
    title: run.title,
    meta: `${rollouts.length} rollouts · ${scored.length} scored`,
    growth,
    currentScore: last.toFixed(1),
    curve,
    tiles: [
      {
        cap: 'AVG SCORE',
        val: a.toFixed(1),
        valColor: 'var(--xml)',
        hint: `global ${globalAvg.toFixed(1)}`,
      },
      {
        cap: 'ROLLOUTS',
        val: String(rollouts.length),
        valColor: 'var(--text-primary)',
        hint: `${scored.length} scored`,
      },
      { cap: 'BEST', val: best.toFixed(1), valColor: 'var(--text-primary)', hint: 'best rollout' },
      {
        cap: 'GROWTH',
        val: (last - first).toFixed(1),
        valColor: 'var(--text-primary)',
        hint: 'last − first',
      },
    ],
    rolloutMeta: `${rollouts.length} rollouts`,
    rollout,
    rubricTrainer: 'claude -p',
    rubric,
    total: vals.length ? `[SCORE: ${a.toFixed(1)}/10]` : '—',
  }
}
