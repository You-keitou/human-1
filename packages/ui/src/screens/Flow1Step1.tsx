import type { ReactElement } from 'react'
import { DraftStatus, EditorTopBar, Toolbar } from '../components/EditorBars'
import { Header } from '../components/Header'
import { Icon } from '../components/Icon'
import { RequestCard } from '../components/RequestCard'
import { DesktopFrame } from '../components/ScreenFrame'
import { flow1Fixture } from '../fixtures/screens'
import { Frame, Spacer, Text } from '../ui/primitives'

// Flow 1 Step 1 実行中(`x03Nex`)。step1 送信済み・harness ツール実行中・エディタ read-only。
export function Flow1Step1(): ReactElement {
  return (
    <DesktopFrame>
      <Header active="workspace" epoch={3} avg="8.4" />
      <Frame dir="row" grow w="fill" gap={20} pad={20} align="start">
        <RequestCard timer={{ text: '—:—', tone: 'muted' }} />
        <EditorCard />
      </Frame>
    </DesktopFrame>
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
        right={<DraftStatus dot="var(--tool)" text="下書き · 自動保存" />}
      />
      <Toolbar active={false} />

      {/* StatusStrip(Flow1 固有) */}
      <Frame
        dir="row"
        w="fill"
        gap={8}
        pad={[6, 18]}
        align="center"
        fill="var(--surface2)"
        borderSides={{ bottom: 1 }}
        borderColor="var(--border)"
      >
        <Icon name="loader-circle" size={13} color="var(--accent)" />
        <Text size={11.5} weight={500} color="var(--text-secondary)" nowrap>
          {flow1Fixture.status.text}
        </Text>
        <Spacer />
        <Text size={11} family="mono" weight={600} color="var(--text-muted)" nowrap>
          {flow1Fixture.status.elapsed}
        </Text>
      </Frame>

      {/* EditorBody: 送信済み read-only */}
      <Frame dir="col" w="fill" grow gap={10} pad={[12, 20]} align="start" clip>
        <ThinkingBlock />
        <FunctionCallsBlock />
      </Frame>

      {/* BottomBar */}
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
        <Frame dir="row" gap={7} pad={[9, 20]} align="center" radius={6} fill="var(--surface3)">
          <Icon name="loader-circle" size={15} color="var(--text-muted)" />
          <Text size={13} weight={600} color="var(--text-muted)" nowrap>
            結果を待機中…
          </Text>
        </Frame>
      </Frame>
    </Frame>
  )
}

function ThinkingBlock(): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={5}
      pad={[10, 14]}
      radius={6}
      fill="var(--thinking-soft)"
      borderSides={{ left: 2 }}
      borderColor="var(--thinking)"
      align="start"
    >
      <Frame dir="row" w="fill" gap={7} align="center">
        <Icon name="brain" size={14} color="var(--thinking)" />
        <Text size={11} family="mono" weight={600} color="var(--thinking)" nowrap>
          thinking
        </Text>
        <Spacer />
        <Frame
          dir="row"
          gap={5}
          pad={[2, 8]}
          align="center"
          radius={999}
          fill="var(--surface)"
          border={[1, 'var(--border)']}
        >
          <Icon name="check" size={10} color="var(--tool)" />
          <Text size={10.5} weight={600} color="var(--text-secondary)" nowrap>
            送信済み
          </Text>
        </Frame>
      </Frame>
      <Text size={13} lh={21 / 13} italic color="var(--text-secondary)" w="fill">
        {flow1Fixture.thinking}
      </Text>
    </Frame>
  )
}

function FunctionCallsBlock(): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={7}
      pad={[10, 14]}
      radius={6}
      fill="var(--tool-soft)"
      borderSides={{ left: 2 }}
      borderColor="var(--tool)"
      align="start"
    >
      <Frame dir="row" w="fill" gap={7} align="center">
        <Icon name="terminal" size={14} color="var(--tool)" />
        <Text size={11} family="mono" weight={600} color="var(--tool)" nowrap>
          function_calls
        </Text>
        <Spacer />
        <Frame
          dir="row"
          gap={5}
          pad={[3, 9]}
          align="center"
          radius={999}
          fill="var(--surface)"
          border={[1, 'var(--border)']}
        >
          <Icon name="zap" size={11} color="var(--warn)" />
          <Text size={11} weight={600} color="var(--text-secondary)" nowrap>
            並列 ×2
          </Text>
        </Frame>
      </Frame>
      {flow1Fixture.invokes.map((iv) => (
        <InvokeRow key={iv.name} {...iv} />
      ))}
    </Frame>
  )
}

function InvokeRow({
  icon,
  iconColor,
  name,
  param,
  status,
  statusColor,
}: {
  icon: 'check' | 'loader-circle'
  iconColor: string
  name: string
  param: string
  status: string
  statusColor: string
}): ReactElement {
  return (
    <Frame
      dir="row"
      w="fill"
      gap={9}
      pad={[8, 12]}
      align="center"
      radius={6}
      fill="var(--surface)"
      border={[1, 'var(--border)']}
    >
      <Icon name={icon} size={13} color={iconColor} />
      <Text size={12} family="mono" weight={600} nowrap>
        {name}
      </Text>
      <Text size={11} family="mono" color="var(--text-muted)" nowrap>
        {param}
      </Text>
      <Spacer />
      <Text size={10.5} family="mono" weight={600} color={statusColor} nowrap>
        {status}
      </Text>
    </Frame>
  )
}
