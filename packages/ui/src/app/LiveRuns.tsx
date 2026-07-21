import type { TrainingRun } from '@human-1/shared'
import { type ReactElement, type ReactNode, useEffect, useState } from 'react'
import { fetchRun, fetchRuns } from '../lib/api'
import { buildRunsView, type RunDetailData } from '../lib/runsView'
import { RunsBody } from '../screens/Runs'
import { Frame, Text } from '../ui/primitives'
import { LiveHeader } from './LiveHeader'
import { CenteredBody, WideCenteredBody } from './liveLayout'

// live の /runs は LiveHeader(実 <a> ナビ + テーマスイッチャ内蔵)を使い、本体は px 凍結の
// 静的レイアウトと同形の RunsBody を max-width 中央寄せで描く。WS を張らないため answered/live
// は出さず、avg のみ表示(runs の文脈で自然)。/preview/runs の静的ヘッダは触らない。
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

  let message: string | null = null
  if (error) message = `読み込みエラー: ${error}`
  else if (!runs) message = '読み込み中…'
  else if (runs.length === 0) message = '訓練 run がまだありません'

  let avg = '0.0'
  let body: ReactNode
  if (message !== null) {
    body = <CenteredBody>{<Centered text={message} />}</CenteredBody>
  } else {
    const data = buildRunsView(runs as TrainingRun[], details, runs?.[0]?.id ?? null)
    avg = data.header.avg
    // Runs は desktop 専用。狭い画面ではページを横スクロールさせず本体だけ内部スクロール。
    body = (
      <WideCenteredBody>
        <RunsBody data={data} />
      </WideCenteredBody>
    )
  }

  return (
    <Frame dir="col" w="fill" style={{ minHeight: '100vh' }}>
      <LiveHeader active="runs" avg={avg} />
      {body}
    </Frame>
  )
}

function Centered({ text }: { text: string }): ReactElement {
  return (
    <Frame dir="col" grow w="fill" align="center" justify="center" style={{ minHeight: '60vh' }}>
      <Text size={14} color="var(--text-secondary)" family="mono">
        {text}
      </Text>
    </Frame>
  )
}
