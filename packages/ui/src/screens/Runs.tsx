import type { ReactElement } from 'react'
import { Header } from '../components/Header'
import { DesktopFrame } from '../components/ScreenFrame'
import {
  type RolloutChip,
  type RolloutRow,
  type RubricItem,
  type RunListItem,
  type RunsFixture,
  runsFixture,
} from '../fixtures/runs'
import { Box, Frame, Spacer, Text } from '../ui/primitives'

const DOT: Record<RunListItem['dot'], string> = {
  accent: 'var(--accent)',
  tool: 'var(--tool)',
  warn: 'var(--warn)',
}

const CHIP: Record<RolloutChip['kind'], { fill: string; color: string }> = {
  thinking: { fill: 'var(--thinking-soft)', color: 'var(--thinking)' },
  tool: { fill: 'var(--tool-soft)', color: 'var(--tool)' },
  final: { fill: 'var(--accent-soft)', color: 'var(--accent-strong)' },
}

// data 注入で live(API 由来)/ preview(fixture)双方を同一レイアウトで描画する。
// 既定は fixture のため /preview/runs のピクセルは不変。
export function Runs({ data = runsFixture }: { data?: RunsFixture }): ReactElement {
  const { header } = data
  return (
    <DesktopFrame>
      <Header active="runs" epoch={header.epoch} avg={header.avg} />
      <RunsBody data={data} />
    </DesktopFrame>
  )
}

// 本体(ヘッダーを除く)。preview(/preview/runs)は上の Runs が静的 Header を付けて
// 従来と同一ツリーを描く(px 不変)。live(/runs)は LiveRuns が LiveHeader + 中央寄せで包む。
export function RunsBody({ data = runsFixture }: { data?: RunsFixture }): ReactElement {
  const { list, detail } = data
  return (
    <Frame dir="row" grow w="fill" gap={20} pad={20} align="start">
      <RunsList list={list} />
      <RunDetail detail={detail} />
    </Frame>
  )
}

function RunsList({ list }: { list: RunListItem[] }): ReactElement {
  return (
    <Frame
      dir="col"
      w={400}
      h="fill"
      fill="var(--surface)"
      border={[1, 'var(--border)']}
      radius={8}
      clip
    >
      <Frame
        dir="row"
        w="fill"
        gap={8}
        pad={[13, 18]}
        align="center"
        borderSides={{ bottom: 1 }}
        borderColor="var(--border)"
      >
        <Text size={11} family="mono" color="var(--text-muted)" ls={1.2} nowrap>
          TRAINING RUNS
        </Text>
        <Spacer />
        <Frame dir="row" pad={[3, 10]} radius={999} border={[1, 'var(--border-strong)']}>
          <Text size={10} family="mono" color="var(--text-secondary)" nowrap>
            7 runs
          </Text>
        </Frame>
      </Frame>
      <Frame dir="col" w="fill" grow gap={3} pad={[12, 10]} align="start">
        {list.map((run, i) => (
          <RunRow key={run.title} run={run} last={i === list.length - 1} />
        ))}
      </Frame>
    </Frame>
  )
}

function RunRow({ run, last }: { run: RunListItem; last: boolean }): ReactElement {
  const barFill = run.selected ? 'var(--accent)' : 'var(--border-strong)'
  const avgColor = run.selected ? 'var(--xml)' : 'var(--text-secondary)'
  return (
    <>
      <Frame
        dir="row"
        w="fill"
        gap={12}
        pad={[13, 14]}
        align="center"
        radius={6}
        fill={run.selected ? 'var(--accent-soft)' : undefined}
        borderSides={run.selected ? { left: 2 } : undefined}
        borderColor="var(--accent)"
      >
        <Frame dir="col" grow gap={5} align="start">
          <Frame dir="row" gap={8} align="center">
            <Box w={7} h={7} fill={DOT[run.dot]} radius={999} />
            <Text size={14} weight={600} nowrap>
              {run.title}
            </Text>
          </Frame>
          <Text size={11} family="mono" color="var(--text-muted)" nowrap>
            {run.meta}
          </Text>
        </Frame>
        <Frame dir="row" gap={3} h={26} align="end">
          {run.bars.map((bh, i) => (
            <Box key={i} w={6} h={bh} fill={barFill} radius={2} />
          ))}
        </Frame>
        <Frame dir="col" gap={1} align="end">
          <Text size={17} family="display" weight={600} color={avgColor} nowrap>
            {run.avg}
          </Text>
          <Text size={9} family="mono" color="var(--text-muted)" ls={1} nowrap>
            avg
          </Text>
        </Frame>
      </Frame>
      {!last && <Box w="fill" h={1} fill="var(--border)" />}
    </>
  )
}

function RunDetail({ detail }: { detail: (typeof runsFixture)['detail'] }): ReactElement {
  return (
    <Frame dir="col" grow h="fill" gap={16} align="start">
      <Frame dir="row" w="fill" gap={16} align="center">
        <Frame dir="col" grow gap={5} align="start">
          <Frame dir="row" gap={10} align="center">
            <Frame dir="row" pad={[3, 8]} radius={6} border={[1, 'var(--border-strong)']}>
              <Text size={11} family="mono" color="var(--text-secondary)" nowrap>
                {detail.tag}
              </Text>
            </Frame>
            <Text size={24} family="display" weight={600} nowrap>
              {detail.title}
            </Text>
          </Frame>
          <Text size={11} family="mono" color="var(--text-muted)" nowrap>
            {detail.meta}
          </Text>
        </Frame>
        <Frame dir="row" pad={[6, 13]} align="center" radius={999} border={[1, 'var(--tool)']}>
          <Text size={12} family="mono" weight={600} color="var(--tool)" nowrap>
            {detail.growth}
          </Text>
        </Frame>
        <Frame dir="col" gap={1} align="end">
          <Text size={32} family="display" weight={600} color="var(--xml)" nowrap>
            {detail.currentScore}
          </Text>
          <Text size={9} family="mono" color="var(--text-muted)" ls={1.5} nowrap>
            CURRENT SCORE
          </Text>
        </Frame>
      </Frame>

      <CurveCard curve={detail.curve} />

      <Frame dir="row" w="fill" gap={14} align="start">
        {detail.tiles.map((t) => (
          <Frame
            key={t.cap}
            dir="col"
            grow
            gap={5}
            pad={[13, 16]}
            fill="var(--surface)"
            border={[1, 'var(--border)']}
            radius={8}
            align="start"
          >
            <Text size={9} family="mono" color="var(--text-muted)" ls={1.2} nowrap>
              {t.cap}
            </Text>
            <Text size={26} family="display" weight={600} color={t.valColor} nowrap>
              {t.val}
            </Text>
            <Text size={10} family="mono" color="var(--text-muted)" nowrap>
              {t.hint}
            </Text>
          </Frame>
        ))}
      </Frame>

      <Frame dir="row" w="fill" grow gap={16} align="start">
        <RolloutCard meta={detail.rolloutMeta} rows={detail.rollout} />
        <RubricCard trainer={detail.rubricTrainer} rubric={detail.rubric} total={detail.total} />
      </Frame>
    </Frame>
  )
}

function CurveCard({ curve }: { curve: (typeof runsFixture)['detail']['curve'] }): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={14}
      pad={[16, 20]}
      fill="var(--surface)"
      border={[1, 'var(--border)']}
      radius={8}
      align="start"
    >
      <Frame dir="row" w="fill" gap={8} align="center">
        <Text size={11} family="mono" color="var(--text-muted)" ls={1.2} nowrap>
          LEARNING CURVE
        </Text>
        <Spacer />
        <Text size={10} family="mono" color="var(--text-muted)" nowrap>
          score / epoch
        </Text>
      </Frame>
      <Frame dir="row" w="fill" gap={12} align="end">
        <Frame dir="col" w={22} h={150} justify="between" align="end">
          {['10', '8', '6', '4', '2', '0'].map((y) => (
            <Text key={y} size={10} family="mono" color="var(--text-muted)" nowrap>
              {y}
            </Text>
          ))}
        </Frame>
        <Frame dir="row" grow gap={14} align="end">
          {curve.map((ep) => (
            <Frame key={ep.label} dir="col" grow h={150} gap={6} justify="end" align="center">
              <Text
                size={11}
                family="mono"
                weight={ep.bold ? 700 : 400}
                color={ep.bold ? 'var(--xml)' : 'var(--text-secondary)'}
                nowrap
              >
                {ep.value}
              </Text>
              <Box w={34} h={ep.height} fill="var(--curve)" radius={[3, 3, 0, 0]} />
            </Frame>
          ))}
        </Frame>
      </Frame>
      <Box w="fill" h={1} fill="var(--border)" />
      <Frame dir="row" w="fill" gap={14} style={{ paddingLeft: 34 }}>
        {curve.map((ep) => (
          <Text
            key={ep.label}
            size={11}
            family="mono"
            color="var(--text-muted)"
            align="center"
            grow
          >
            {ep.label}
          </Text>
        ))}
      </Frame>
    </Frame>
  )
}

function RolloutCard({ meta, rows }: { meta: string; rows: RolloutRow[] }): ReactElement {
  return (
    <Frame
      dir="col"
      grow
      h="fill"
      gap={8}
      pad={[14, 16]}
      fill="var(--surface)"
      border={[1, 'var(--border)']}
      radius={8}
      clip
      align="start"
    >
      <Frame dir="row" w="fill" gap={8} align="center">
        <Text size={11} family="mono" color="var(--text-muted)" ls={1.2} nowrap>
          ROLLOUT TIMELINE
        </Text>
        <Spacer />
        <Text size={10} family="mono" color="var(--text-muted)" nowrap>
          {meta}
        </Text>
      </Frame>
      {rows.map((row) => (
        <Frame
          key={row.turn}
          dir="row"
          w="fill"
          gap={10}
          pad={[6, 8]}
          radius={6}
          align="center"
          fill={row.selected ? 'var(--accent-soft)' : undefined}
        >
          <Box w={7} h={7} fill={row.selected ? 'var(--accent)' : 'var(--curve)'} radius={999} />
          <Text size={11} family="mono" color="var(--text-secondary)" w={54}>
            {row.turn}
          </Text>
          <Frame dir="row" grow gap={6} align="center">
            {row.chips.map((chip, i) => (
              <Frame key={i} dir="row" pad={[2, 8]} radius={999} fill={CHIP[chip.kind].fill}>
                <Text size={10} family="mono" color={CHIP[chip.kind].color} nowrap>
                  {chip.label}
                </Text>
              </Frame>
            ))}
          </Frame>
          <Text size={13} family="mono" weight={700} color="var(--xml)" nowrap>
            {row.score}
          </Text>
        </Frame>
      ))}
    </Frame>
  )
}

function RubricCard({
  trainer,
  rubric,
  total,
}: {
  trainer: string
  rubric: RubricItem[]
  total: string
}): ReactElement {
  return (
    <Frame
      dir="col"
      w={400}
      h="fill"
      gap={10}
      pad={[14, 16]}
      fill="var(--surface)"
      border={[1, 'var(--border)']}
      radius={8}
      clip
      align="start"
    >
      <Frame dir="row" w="fill" gap={8} align="center">
        <Text size={11} family="mono" color="var(--text-muted)" ls={1.2} nowrap>
          TRAINER RUBRIC v2
        </Text>
        <Spacer />
        <Text size={10} family="mono" color="var(--text-muted)" nowrap>
          {trainer}
        </Text>
      </Frame>
      {rubric.map((r) => (
        <Frame key={r.name} dir="col" w="fill" gap={4} align="start">
          <Frame dir="row" w="fill" gap={8} align="center">
            <Text size={13} weight={600} nowrap>
              {r.name}
            </Text>
            <Spacer />
            <Frame dir="row" pad={[2, 8]} radius={6} fill="var(--surface2)">
              <Text size={11} family="mono" weight={700} color="var(--xml)" nowrap>
                {r.score}
              </Text>
            </Frame>
          </Frame>
          <Text size={11} family="mono" color="var(--text-muted)" w="fill">
            {r.desc}
          </Text>
        </Frame>
      ))}
      <Box w="fill" h={1} fill="var(--border)" />
      <Frame dir="row" w="fill" gap={8} align="center">
        <Text size={13} weight={700} nowrap>
          TOTAL · weighted
        </Text>
        <Spacer />
        <Frame dir="row" pad={[3, 9]} radius={6} fill="var(--accent-soft)">
          <Text size={11} family="mono" weight={700} color="var(--accent-strong)" nowrap>
            {total}
          </Text>
        </Frame>
      </Frame>
    </Frame>
  )
}
