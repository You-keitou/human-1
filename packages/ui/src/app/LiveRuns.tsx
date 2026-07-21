import type { TrainingRun } from '@human-1/shared'
import { type ReactElement, useEffect, useState } from 'react'
import { fetchRun, fetchRuns } from '../lib/api'
import { buildRunsView, type RunDetailData } from '../lib/runsView'
import { Runs } from '../screens/Runs'
import { Frame, Text } from '../ui/primitives'
import { ThemeSwitcher } from './ThemeSwitcher'

// /runs は px 凍結の静的 Runs ヘッダを流用するため、カラーモード切替を右上に浮かせて添える
// (テーマは localStorage でグローバル永続。Workspace と同じ操作性を /runs でも保つ)。
function FloatingTheme(): ReactElement {
  return (
    <div style={{ position: 'fixed', top: 14, right: 16, zIndex: 50 }}>
      <ThemeSwitcher />
    </div>
  )
}

// /api/runs から一覧・詳細・スコアを取得し、Runs レイアウト(fixture と同形)へ流し込む。
export function LiveRuns({ token }: { token: string }): ReactElement {
  const [runs, setRuns] = useState<TrainingRun[] | null>(null)
  const [details, setDetails] = useState<Map<string, RunDetailData>>(new Map())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { runs: list } = await fetchRuns(token)
        if (cancelled) return
        setRuns(list)
        const entries = await Promise.all(
          list.map(async (r) => {
            const d = await fetchRun(r.id, token)
            return [r.id, { run: d.run, rollouts: d.rollouts }] as const
          }),
        )
        if (cancelled) return
        setDetails(new Map(entries))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  if (error) return <Centered text={`読み込みエラー: ${error}`} />
  if (!runs) return <Centered text="読み込み中…" />
  if (runs.length === 0) return <Centered text="訓練 run がまだありません" />

  const selectedId = runs[0]?.id ?? null
  const data = buildRunsView(runs, details, selectedId)
  return (
    <>
      <FloatingTheme />
      <Runs data={data} />
    </>
  )
}

function Centered({ text }: { text: string }): ReactElement {
  return (
    <Frame dir="col" w="fill" align="center" justify="center" style={{ minHeight: '60vh' }}>
      <Text size={14} color="var(--text-secondary)" family="mono">
        {text}
      </Text>
    </Frame>
  )
}
