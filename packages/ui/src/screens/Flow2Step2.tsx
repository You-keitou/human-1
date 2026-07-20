import type { ReactElement } from 'react'
import { DraftStatus, EditorTopBar, Toolbar } from '../components/EditorBars'
import { Header } from '../components/Header'
import { Icon, type IconName } from '../components/Icon'
import { DesktopFrame } from '../components/ScreenFrame'
import { Box, Frame, Spacer, Text } from '../ui/primitives'

const TRAINER_LINE =
  '前エポックの講評: DB分割の判断は良い(+1.5)。今回は EC サイトの注文システムを設計せよ。全体アーキテクチャと ER 図を含めること。'

// Flow 2 Step 2 開始(`pvtJF`)。tool_result ×2 受信済み・step2 を書き始める直前。
export function Flow2Step2(): ReactElement {
  return (
    <DesktopFrame>
      <Header active="workspace" epoch={3} avg="8.4" />
      <Frame dir="row" grow w="fill" gap={20} pad={20} align="start">
        <RequestCard />
        <EditorCard />
      </Frame>
    </DesktopFrame>
  )
}

function CollapsedRow({ label, right }: { label: string; right: string }): ReactElement {
  return (
    <Frame
      dir="row"
      w="fill"
      gap={8}
      pad={[8, 14]}
      radius={6}
      fill="var(--surface2)"
      align="center"
    >
      <Text size={10} color="var(--text-muted)" nowrap>
        ▸
      </Text>
      <Text size={10} family="mono" color="var(--text-muted)" ls={1.2} nowrap>
        {label}
      </Text>
      <Spacer />
      <Text size={10} family="mono" color="var(--text-muted)" nowrap>
        {right}
      </Text>
    </Frame>
  )
}

function RequestCard(): ReactElement {
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
        <Text size={10} family="mono" color="var(--text-muted)" ls={1.2} nowrap>
          REQUEST · TURN 4 · STEP 2
        </Text>
        <Spacer />
        <Frame dir="row" gap={6} align="center">
          <Icon name="brain" size={13} color="var(--thinking)" />
          <Text size={12} family="mono" weight={600} color="var(--thinking)" nowrap>
            00:07
          </Text>
        </Frame>
      </Frame>

      <Frame dir="col" w="fill" grow gap={10} pad={18} align="start">
        <CollapsedRow label="SYSTEM" right="8.2k chars" />
        <CollapsedRow label="TOOLS" right="リクエストで定義 · 4" />

        <Frame
          dir="col"
          w="fill"
          gap={7}
          pad={[11, 16]}
          radius={6}
          fill="var(--accent-soft)"
          borderSides={{ left: 2 }}
          borderColor="var(--accent)"
          align="start"
        >
          <Text size={10} family="mono" weight={600} color="var(--accent-strong)" ls={1.2} nowrap>
            TRAINER · EPOCH 3
          </Text>
          <Text size={13} lh={21 / 13} w="fill">
            {TRAINER_LINE}
          </Text>
        </Frame>

        <Frame
          dir="col"
          w="fill"
          gap={7}
          pad={[9, 16]}
          radius={6}
          fill="var(--surface2)"
          borderSides={{ left: 2 }}
          borderColor="var(--border-strong)"
          align="start"
        >
          <Frame dir="row" w="fill" gap={7} align="center">
            <Text size={10} family="mono" weight={600} color="var(--text-muted)" ls={1.2} nowrap>
              YOU · STEP 1
            </Text>
            <Icon name="check" size={11} color="var(--tool)" />
            <Spacer />
            <Text size={9.5} family="mono" color="var(--text-muted)" nowrap>
              12:04:31
            </Text>
          </Frame>
          <Frame dir="row" w="fill" gap={6} align="center">
            <Text size={10} color="var(--text-muted)" nowrap>
              ▸
            </Text>
            <Text size={11} family="mono" italic color="var(--text-muted)" grow>
              {'<thinking> 注文システムの核は在庫と決済の整合性…'}
            </Text>
          </Frame>
          <Frame dir="row" gap={6} align="center">
            <YouChip name="exec_command" icon="terminal" />
            <YouChip name="web_search" icon="search" />
          </Frame>
        </Frame>

        <ToolResult
          tool="exec_command · exit 0 · 0.4s"
          body={'schema.sql · 42 lines\nCREATE TABLE orders (id uuid PRIMARY KEY, user_id uuid, …'}
        />
        <ToolResult
          tool="web_search · 5 results · 1.2s"
          body={
            'Saga pattern — microservices.io\n分散トランザクションを結果整合で実装するパターン…'
          }
        />
      </Frame>
    </Frame>
  )
}

function YouChip({ name, icon }: { name: string; icon: IconName }): ReactElement {
  return (
    <Frame
      dir="row"
      gap={5}
      pad={[3, 9]}
      align="center"
      radius={999}
      fill="var(--surface)"
      border={[1, 'var(--border)']}
    >
      <Icon name={icon} size={11} color="var(--text-secondary)" />
      <Text size={10.5} family="mono" color="var(--text-secondary)" nowrap>
        {name}
      </Text>
      <Icon name="check" size={10} color="var(--tool)" />
    </Frame>
  )
}

function ToolResult({ tool, body }: { tool: string; body: string }): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={5}
      pad={[9, 16]}
      radius={6}
      fill="var(--tool-soft)"
      borderSides={{ left: 2 }}
      borderColor="var(--tool)"
      align="start"
    >
      <Frame dir="row" w="fill" gap={8} align="center">
        <Text size={10.5} family="mono" color="var(--warn)" nowrap>
          [tool_result]
        </Text>
        <Text size={10.5} family="mono" weight={600} color="var(--tool)" nowrap>
          {tool}
        </Text>
        <Spacer />
        <Frame dir="row" pad={[1, 6]} radius={4} fill="var(--surface)">
          <Text size={8.5} family="mono" weight={600} color="var(--tool)" ls={0.5} nowrap>
            NEW
          </Text>
        </Frame>
      </Frame>
      <Text
        size={11}
        family="mono"
        lh={17 / 11}
        color="var(--text-secondary)"
        w="fill"
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {body}
      </Text>
    </Frame>
  )
}

function EditorCard(): ReactElement {
  return (
    <Frame
      dir="col"
      grow
      h="fill"
      fill="var(--surface)"
      border={[1, 'var(--border)']}
      radius={8}
      clip
    >
      <EditorTopBar
        activeTab="raw"
        right={
          <>
            <Frame dir="row" pad={[3, 10]} radius={999} fill="var(--accent-soft)">
              <Text
                size={10}
                family="mono"
                weight={600}
                color="var(--accent-strong)"
                ls={0.8}
                nowrap
              >
                STEP 2
              </Text>
            </Frame>
            <DraftStatus dot="var(--border-strong)" text="下書きなし" />
          </>
        }
      />
      <Toolbar active hint="/ でブロック挿入" />

      <Frame dir="col" w="fill" grow gap={12} pad={[14, 20]} align="start" clip>
        <Stepper />
        <Frame
          dir="row"
          w="fill"
          gap={9}
          pad={[9, 16]}
          radius={6}
          fill="var(--tool-soft)"
          borderSides={{ left: 2 }}
          borderColor="var(--tool)"
          align="center"
        >
          <Icon name="inbox" size={14} color="var(--tool)" />
          <Text size={12.5} weight={500} color="var(--text-secondary)" nowrap>
            tool_result ×2 を受信しました — エディタをリセットし、step 2 を開始
          </Text>
          <Spacer />
          <Text size={11.5} weight={600} color="var(--tool)" nowrap>
            結果を表示 ←
          </Text>
        </Frame>

        <Frame dir="row" gap={3} pad={[4, 2]} align="center">
          <Box w={2} h={17} fill="var(--accent)" />
          <Text size={13.5} color="var(--text-muted)" nowrap>
            tool の結果を踏まえて、続きの thinking / final を書く…
          </Text>
        </Frame>

        <Frame dir="row" gap={8} pad={2} align="center">
          <Text size={9.5} family="mono" color="var(--text-muted)" ls={1} nowrap>
            クイックスタート
          </Text>
          <QuickChip
            icon="brain"
            label="続きの thinking"
            fill="var(--thinking-soft)"
            color="var(--thinking)"
          />
          <QuickChip
            icon="terminal"
            label="さらに tool call"
            fill="var(--tool-soft)"
            color="var(--tool)"
          />
          <QuickChip
            icon="corner-down-right"
            label="final を書く"
            fill="var(--surface2)"
            color="var(--text-secondary)"
          />
        </Frame>
      </Frame>

      <Frame
        dir="row"
        w="fill"
        gap={12}
        pad={[12, 18]}
        align="center"
        borderSides={{ top: 1 }}
        borderColor="var(--border)"
      >
        <Text size={11} family="mono" color="var(--text-muted)" nowrap>
          ⌘↵ で送信 · thinking → tools → final の順で配信
        </Text>
        <Spacer />
        <Frame
          dir="row"
          gap={6}
          pad={[8, 14]}
          align="center"
          radius={6}
          border={[1, 'var(--border-strong)']}
        >
          <Icon name="activity" size={14} color="var(--text-secondary)" />
          <Text size={13} weight={600} color="var(--text-secondary)" nowrap>
            途中経過
          </Text>
        </Frame>
        <Frame dir="row" gap={7} pad={[9, 20]} align="center" radius={6} fill="var(--surface3)">
          <Text size={13} weight={700} color="var(--text-muted)" nowrap>
            送信
          </Text>
          <Icon name="arrow-up" size={15} color="var(--text-muted)" />
        </Frame>
      </Frame>
    </Frame>
  )
}

function Stepper(): ReactElement {
  return (
    <Frame dir="row" gap={8} align="center">
      <StepDot />
      <Text size={10.5} family="mono" color="var(--text-muted)" nowrap>
        step 1 送信
      </Text>
      <Box w={22} h={1} fill="var(--border-strong)" />
      <StepDot />
      <Text size={10.5} family="mono" color="var(--text-muted)" nowrap>
        tools 実行 ×2
      </Text>
      <Box w={22} h={1} fill="var(--border-strong)" />
      <Frame
        dir="row"
        w={16}
        h={16}
        justify="center"
        align="center"
        radius={999}
        fill="var(--accent)"
      >
        <Text size={9} family="mono" weight={600} color="var(--on-accent)" nowrap>
          2
        </Text>
      </Frame>
      <Text size={10.5} family="mono" weight={600} nowrap>
        step 2 作成中
      </Text>
    </Frame>
  )
}

function StepDot(): ReactElement {
  return (
    <Frame
      dir="row"
      w={16}
      h={16}
      justify="center"
      align="center"
      radius={999}
      fill="var(--surface)"
      border={[1, 'var(--tool)']}
    >
      <Icon name="check" size={9} color="var(--tool)" />
    </Frame>
  )
}

function QuickChip({
  icon,
  label,
  fill,
  color,
}: {
  icon: IconName
  label: string
  fill: string
  color: string
}): ReactElement {
  return (
    <Frame dir="row" gap={6} pad={[5, 11]} align="center" radius={6} fill={fill}>
      <Icon name={icon} size={12} color={color} />
      <Text size={11.5} weight={600} color={color} nowrap>
        {label}
      </Text>
    </Frame>
  )
}
