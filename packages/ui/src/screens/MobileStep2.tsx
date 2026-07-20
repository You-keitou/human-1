import type { ReactElement } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { MobileFrame } from '../components/ScreenFrame'
import { mobileStep2Fixture } from '../fixtures/screens'
import { Box, Frame, Spacer, Text } from '../ui/primitives'

// Mobile Step 2(`cUfSM`)。履歴(trainer / you step1 / tool_result ×2 / banner)+ 下部エディタ。送信 disabled。
export function MobileStep2(): ReactElement {
  return (
    <MobileFrame>
      <MHeader />
      <Frame dir="col" grow w="fill" gap={10} pad={[12, 16]} align="start" clip>
        <TrainerCard />
        <YouCard />
        {mobileStep2Fixture.results.map((r) => (
          <ResultCard key={r.name} icon={r.icon} name={r.name} meta={r.meta} body={r.body} />
        ))}
        <Banner />
      </Frame>
      <EditorWrap />
      <BottomBar />
    </MobileFrame>
  )
}

function MHeader(): ReactElement {
  return (
    <Frame
      dir="row"
      w="fill"
      gap={8}
      pad={[16, 16, 12, 16]}
      align="center"
      borderSides={{ bottom: 1 }}
      borderColor="var(--border)"
    >
      <Frame dir="row" gap={8} align="center">
        <Box w={8} h={8} fill="var(--accent)" radius={999} />
        <Text size={16} family="display" weight={600} nowrap>
          human-1
        </Text>
      </Frame>
      <Spacer />
      <Frame
        dir="row"
        pad={[4, 10]}
        align="center"
        radius={999}
        border={[1, 'var(--border-strong)']}
      >
        <Text size={10} family="mono" color="var(--text-secondary)" ls={0.5} nowrap>
          TURN 4 · STEP 2
        </Text>
      </Frame>
      <Box w={7} h={7} fill="var(--tool)" radius={999} />
    </Frame>
  )
}

function TrainerCard(): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={7}
      pad={[10, 14, 11, 14]}
      radius={8}
      fill="var(--accent-soft)"
      borderSides={{ left: 2 }}
      borderColor="var(--accent)"
      align="start"
    >
      <Frame dir="row" w="fill" gap={8} align="center">
        <Text size={10} family="mono" weight={600} color="var(--accent-strong)" ls={1.2} nowrap>
          TRAINER · EPOCH 3
        </Text>
        <Spacer />
        <Icon name="chevron-down" size={14} color="var(--text-muted)" />
      </Frame>
      <Text size={13} lh={20 / 13} w="fill">
        {mobileStep2Fixture.trainer}
      </Text>
    </Frame>
  )
}

function YouCard(): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={8}
      pad={[10, 14, 11, 14]}
      radius={8}
      fill="var(--surface2)"
      borderSides={{ left: 2 }}
      borderColor="var(--border-strong)"
      align="start"
    >
      <Frame dir="row" w="fill" gap={6} align="center">
        <Text size={10} family="mono" weight={600} color="var(--text-muted)" ls={1.2} nowrap>
          YOU · STEP 1
        </Text>
        <Icon name="check" size={12} color="var(--tool)" />
        <Spacer />
        <Icon name="chevron-down" size={14} color="var(--text-muted)" />
      </Frame>
      <Frame dir="row" w="fill" gap={6} align="center">
        <Icon name="brain" size={12} color="var(--thinking)" />
        <Text size={12.5} italic color="var(--text-secondary)" nowrap>
          {mobileStep2Fixture.youThinking}
        </Text>
      </Frame>
      <Frame dir="row" gap={6} align="center">
        <MChip name="exec_command" />
        <MChip name="web_search" />
      </Frame>
    </Frame>
  )
}

function MChip({ name }: { name: string }): ReactElement {
  return (
    <Frame
      dir="row"
      gap={5}
      pad={[3, 8]}
      align="center"
      radius={6}
      fill="var(--surface)"
      border={[1, 'var(--border-strong)']}
    >
      <Text size={10.5} family="mono" nowrap>
        {name}
      </Text>
      <Icon name="check" size={11} color="var(--tool)" />
    </Frame>
  )
}

function ResultCard({
  icon,
  name,
  meta,
  body,
}: {
  icon: IconName
  name: string
  meta: string
  body: string
}): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={7}
      pad={[10, 14, 11, 14]}
      radius={8}
      fill="var(--tool-soft)"
      borderSides={{ left: 2 }}
      borderColor="var(--tool)"
      align="start"
    >
      <Frame dir="row" w="fill" gap={7} align="center">
        <Icon name={icon} size={12} color="var(--tool)" />
        <Text size={11} family="mono" weight={600} nowrap>
          {name}
        </Text>
        <Text size={10} family="mono" color="var(--text-muted)" nowrap>
          {meta}
        </Text>
        <Spacer />
        <Frame dir="row" pad={[2, 6]} align="center" radius={4} fill="var(--surface)">
          <Text size={9} family="mono" weight={600} color="var(--tool)" ls={0.8} nowrap>
            NEW
          </Text>
        </Frame>
      </Frame>
      <Frame
        dir="row"
        w="fill"
        pad={[7, 10]}
        radius={6}
        fill="var(--surface)"
        border={[1, 'var(--border)']}
      >
        <Text
          size={10.5}
          family="mono"
          lh={16 / 10.5}
          color="var(--text-secondary)"
          grow
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {body}
        </Text>
      </Frame>
    </Frame>
  )
}

function Banner(): ReactElement {
  return (
    <Frame
      dir="row"
      w="fill"
      gap={8}
      pad={[9, 12]}
      align="center"
      radius={8}
      fill="var(--accent-soft)"
    >
      <Icon name="inbox" size={14} color="var(--accent-strong)" />
      <Text size={12} weight={600} color="var(--accent-strong)" nowrap>
        tool_result ×2 を受信 — step 2 を開始
      </Text>
    </Frame>
  )
}

function EditorWrap(): ReactElement {
  return (
    <Frame dir="col" w="fill" pad={[2, 16, 12, 16]} align="start">
      <Frame
        dir="col"
        w="fill"
        gap={12}
        pad={[14, 14, 12, 14]}
        radius={8}
        fill="var(--surface)"
        border={[1, 'var(--border)']}
        align="start"
      >
        <Frame dir="row" w="fill" gap={7} align="center">
          <Box w={2} h={18} fill="var(--accent)" />
          <Text size={13.5} color="var(--text-muted)" nowrap>
            {mobileStep2Fixture.placeholder}
          </Text>
        </Frame>
        <Box w="fill" h={56} />
        <Frame dir="row" w="fill" gap={6} align="center">
          <QuickPill icon="brain" label="+ Thinking" color="var(--thinking)" />
          <QuickPill icon="terminal" label="+ Tool call" color="var(--tool)" />
          <QuickPill label="final を書く" trailing="arrow-right" color="var(--text-secondary)" />
        </Frame>
      </Frame>
    </Frame>
  )
}

function QuickPill({
  icon,
  label,
  color,
  trailing,
}: {
  icon?: IconName
  label: string
  color: string
  trailing?: IconName
}): ReactElement {
  return (
    <Frame
      dir="row"
      gap={5}
      pad={[6, 9]}
      align="center"
      radius={999}
      border={[1, 'var(--border-strong)']}
    >
      {icon && <Icon name={icon} size={12} color={color} />}
      <Text size={12} weight={500} color={color} nowrap>
        {label}
      </Text>
      {trailing && <Icon name={trailing} size={12} color={color} />}
    </Frame>
  )
}

function BottomBar(): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={10}
      pad={[10, 16, 8, 16]}
      align="start"
      fill="var(--surface)"
      borderSides={{ top: 1 }}
      borderColor="var(--border)"
    >
      <Frame dir="row" w="fill" gap={10} align="center">
        <Frame
          dir="row"
          gap={6}
          pad={[11, 16]}
          align="center"
          radius={6}
          border={[1, 'var(--border-strong)']}
        >
          <Icon name="activity" size={14} color="var(--text-secondary)" />
          <Text size={13} weight={600} color="var(--text-secondary)" nowrap>
            途中経過
          </Text>
        </Frame>
        <Frame
          dir="row"
          grow
          gap={7}
          pad={[12, 0]}
          justify="center"
          align="center"
          radius={6}
          fill="var(--surface3)"
        >
          <Text size={13.5} weight={600} color="var(--text-muted)" nowrap>
            送信
          </Text>
          <Icon name="arrow-up" size={14} color="var(--text-muted)" />
        </Frame>
      </Frame>
      <Frame dir="row" w="fill" justify="center" align="center">
        <Box w={120} h={5} fill="var(--text-primary)" radius={3} />
      </Frame>
    </Frame>
  )
}
