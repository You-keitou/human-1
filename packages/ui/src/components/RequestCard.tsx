import type { ReactElement } from 'react'
import { requestFixture, requestTools } from '../fixtures/request'
import { Frame, Spacer, Text } from '../ui/primitives'
import { Icon } from './Icon'

// 左カラムの Request カード(full 形)。Flow1 / Whiteboard で共有。
// design-spec §2.4 / §3.1 / §3.3。コンテンツは fixtures/request.ts から注入する。

const TOOLS = requestTools
const SYS_PREVIEW = requestFixture.sysPreview
const TRAINER_LINE = requestFixture.trainerLine
const TRAINER_XML = requestFixture.trainerXml

export type RequestTimer = { text: string; tone: 'muted' | 'thinking' }

export function RequestCard({
  timer,
  toolResult,
}: {
  timer: RequestTimer
  toolResult?: boolean
}): ReactElement {
  const timerColor = timer.tone === 'thinking' ? 'var(--thinking)' : 'var(--text-muted)'
  const timerFill = timer.tone === 'thinking' ? 'var(--thinking-soft)' : 'var(--surface2)'
  return (
    <Frame
      dir="col"
      w={440}
      h="fill"
      fill="var(--surface)"
      border={[1, 'var(--border)']}
      radius={8}
      clip
    >
      <Frame
        dir="row"
        w="fill"
        gap={10}
        pad={[13, 18]}
        align="center"
        borderSides={{ bottom: 1 }}
        borderColor="var(--border)"
      >
        <Text size={11} family="mono" color="var(--text-muted)" ls={1.2} nowrap>
          REQUEST · turn 4
        </Text>
        <Spacer />
        <Frame dir="row" gap={5} pad={[4, 10]} align="center" radius={999} fill={timerFill}>
          <Icon name="brain" size={12} color={timerColor} />
          <Text size={12} family="mono" weight={600} color={timerColor} nowrap>
            {timer.text}
          </Text>
        </Frame>
      </Frame>

      <Frame dir="col" w="fill" grow gap={12} pad={18} align="start">
        {/* SYSTEM */}
        <Frame
          dir="col"
          w="fill"
          gap={7}
          pad={[10, 14]}
          radius={6}
          fill="var(--surface2)"
          align="start"
        >
          <Frame dir="row" w="fill" gap={8} align="center">
            <Text size={10} family="mono" color="var(--text-muted)" ls={1.2} nowrap>
              SYSTEM
            </Text>
            <Spacer />
            <Text size={10} family="mono" color="var(--text-muted)" nowrap>
              8.2k chars
            </Text>
          </Frame>
          <Frame dir="row" w="fill" gap={6} align="center">
            <Text size={11} color="var(--text-muted)" nowrap>
              ▸
            </Text>
            <Text size={12} family="mono" color="var(--xml)" grow>
              {SYS_PREVIEW}
            </Text>
          </Frame>
        </Frame>

        {/* TOOLS */}
        <Frame
          dir="col"
          w="fill"
          gap={7}
          pad={[10, 14]}
          radius={6}
          fill="var(--surface2)"
          align="start"
        >
          <Frame dir="row" w="fill" gap={8} align="center">
            <Text size={10} family="mono" color="var(--text-muted)" ls={1.2} nowrap>
              TOOLS
            </Text>
            <Spacer />
            <Text size={10} family="mono" color="var(--text-muted)" nowrap>
              リクエストで定義 · 4
            </Text>
          </Frame>
          {TOOLS.map((t) => (
            <Frame key={t.name} dir="row" w="fill" gap={8} align="center">
              <Icon name={t.icon} size={13} color="var(--tool)" />
              <Text size={12} family="mono" nowrap>
                {t.name}
              </Text>
              <Spacer />
              <Text size={10} family="mono" color="var(--text-muted)" nowrap>
                {t.sig}
              </Text>
            </Frame>
          ))}
        </Frame>

        {/* TRAINER */}
        <Frame
          dir="col"
          w="fill"
          gap={9}
          pad={[12, 16]}
          radius={6}
          fill="var(--accent-soft)"
          borderSides={{ left: 2 }}
          borderColor="var(--accent)"
          align="start"
        >
          <Text size={10} family="mono" weight={600} color="var(--accent-strong)" ls={1.2} nowrap>
            TRAINER · EPOCH 3
          </Text>
          <Text size={14} lh={23 / 14} w="fill">
            {TRAINER_LINE}
          </Text>
          <Text size={12} family="mono" lh={19 / 12} color="var(--xml)" w="fill">
            {TRAINER_XML}
          </Text>
        </Frame>

        {/* tool_result (whiteboard のみ) */}
        {toolResult && (
          <Frame
            dir="col"
            w="fill"
            gap={6}
            pad={[10, 16]}
            radius={6}
            fill="var(--tool-soft)"
            borderSides={{ left: 2 }}
            borderColor="var(--tool)"
            align="start"
          >
            <Frame dir="row" w="fill" gap={8} align="center">
              <Text size={11} family="mono" color="var(--warn)" nowrap>
                [tool_result]
              </Text>
              <Text size={11} family="mono" weight={600} color="var(--tool)" nowrap>
                {requestFixture.toolResult.tool}
              </Text>
            </Frame>
            <Text
              size={12}
              family="mono"
              lh={18 / 12}
              color="var(--text-secondary)"
              w="fill"
              style={{ whiteSpace: 'pre-wrap' }}
            >
              {requestFixture.toolResult.body}
            </Text>
          </Frame>
        )}
      </Frame>
    </Frame>
  )
}
