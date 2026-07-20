import type { ReactElement } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { MobileFrame } from '../components/ScreenFrame'
import { Box, Frame, Spacer, Text } from '../ui/primitives'

// Mobile Answer(`j9b5n`)。1 ターンの完全回答(trainer→thinking→function_calls→final+mermaid)。
export function MobileAnswer(): ReactElement {
  return (
    <MobileFrame>
      <MobHeader />
      <Frame dir="col" grow w="fill" gap={9} pad={[12, 14, 6, 14]} align="start">
        <TrainerCard />
        <ThinkingBlock />
        <FunctionCallsBlock />
        <FinalBlock />
      </Frame>
      <InsertToolbar />
      <MobBar />
    </MobileFrame>
  )
}

function MobHeader(): ReactElement {
  return (
    <Frame
      dir="row"
      w="fill"
      gap={8}
      pad={[12, 16]}
      align="center"
      borderSides={{ bottom: 1 }}
      borderColor="var(--border)"
    >
      <Box w={9} h={9} fill="var(--accent)" radius={999} />
      <Text size={17} family="display" weight={600} nowrap>
        human-1
      </Text>
      <Text size={10.5} family="mono" color="var(--text-muted)" nowrap>
        train
      </Text>
      <Spacer />
      <Frame
        dir="row"
        gap={5}
        pad={[5, 10]}
        align="center"
        radius={999}
        fill="var(--thinking-soft)"
      >
        <Icon name="brain" size={12} color="var(--thinking)" />
        <Text size={12} family="mono" weight={600} color="var(--thinking)" nowrap>
          03:12
        </Text>
      </Frame>
      <Frame dir="row" gap={5} align="center">
        <Box w={8} h={8} fill="var(--tool)" radius={999} />
        <Text size={10.5} family="mono" color="var(--text-muted)" nowrap>
          live
        </Text>
      </Frame>
    </Frame>
  )
}

function TrainerCard(): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={7}
      pad={[11, 14]}
      radius={8}
      fill="var(--accent-soft)"
      borderSides={{ left: 2 }}
      borderColor="var(--accent)"
      align="start"
    >
      <Frame dir="row" w="fill" gap={8} align="center">
        <Text size={10} family="mono" weight={700} color="var(--accent-strong)" ls={1.4} nowrap>
          TRAINER
        </Text>
        <Spacer />
        <Text size={10} family="mono" color="var(--text-muted)" ls={0.4} nowrap>
          EPOCH 3 · 出題
        </Text>
      </Frame>
      <Text size={13.5} weight={500} lh={21 / 13.5} w="fill">
        ECサイトの注文システムを設計せよ。マイクロサービス構成と ER 図を示すこと。
      </Text>
      <Text size={10} family="mono" color="var(--text-muted)" nowrap>
        ▸ system prompt · 8.2k chars
      </Text>
    </Frame>
  )
}

function ThinkingBlock(): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={5}
      pad={[10, 13]}
      radius={8}
      fill="var(--thinking-soft)"
      borderSides={{ left: 2 }}
      borderColor="var(--thinking)"
      align="start"
    >
      <Frame dir="row" w="fill" gap={7} align="center">
        <Icon name="brain" size={13} color="var(--thinking)" />
        <Text size={11} family="mono" weight={600} color="var(--thinking)" nowrap>
          thinking
        </Text>
        <Spacer />
        <Icon name="grip-vertical" size={14} color="var(--thinking)" opacity={0.45} />
      </Frame>
      <Text size={12.5} lh={20 / 12.5} italic color="var(--text-secondary)" w="fill">
        注文・在庫・決済を分離し、在庫は Saga の結果整合で扱うのが要点だ…
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
      pad={[10, 13]}
      radius={8}
      fill="var(--tool-soft)"
      borderSides={{ left: 2 }}
      borderColor="var(--tool)"
      align="start"
    >
      <Frame dir="row" w="fill" gap={7} align="center">
        <Icon name="terminal" size={13} color="var(--tool)" />
        <Text size={11} family="mono" weight={600} color="var(--tool)" nowrap>
          function_calls
        </Text>
        <Spacer />
        <Frame
          dir="row"
          gap={4}
          pad={[3, 8]}
          align="center"
          radius={999}
          fill="var(--surface)"
          border={[1, 'var(--border)']}
        >
          <Icon name="zap" size={10} color="var(--warn)" />
          <Text size={10.5} weight={600} color="var(--text-secondary)" nowrap>
            並列 ×2
          </Text>
        </Frame>
      </Frame>
      <InvokeXml value="architecture.md" />
      <InvokeXml value="er-diagram.mmd" />
    </Frame>
  )
}

function InvokeXml({ value }: { value: string }): ReactElement {
  const tool = 'var(--tool)'
  const muted = 'var(--text-muted)'
  const xml = 'var(--xml)'
  return (
    <Frame
      dir="col"
      w="fill"
      gap={2}
      pad={[7, 10]}
      radius={6}
      fill="var(--surface)"
      border={[1, 'var(--border)']}
      align="start"
    >
      <Frame dir="row" align="center">
        <Text size={10.5} family="mono" color={tool} nowrap>
          {'<invoke name='}
        </Text>
        <Text size={10.5} family="mono" weight={600} color={xml} nowrap>
          "write_doc"
        </Text>
        <Text size={10.5} family="mono" color={tool} nowrap>
          {'>'}
        </Text>
      </Frame>
      <Frame dir="row" align="center" style={{ paddingLeft: 10 }}>
        <Text size={10} family="mono" color={muted} nowrap>
          {'<parameter name='}
        </Text>
        <Text size={10} family="mono" color={xml} nowrap>
          "path"
        </Text>
        <Text size={10} family="mono" color={muted} nowrap>
          {'>'}
        </Text>
        <Text size={10} family="mono" color="var(--text-secondary)" nowrap>
          {value}
        </Text>
        <Text size={10} family="mono" color={muted} nowrap>
          {'</parameter>'}
        </Text>
      </Frame>
      <Text size={10.5} family="mono" color={tool} nowrap>
        {'</invoke>'}
      </Text>
    </Frame>
  )
}

function FinalBlock(): ReactElement {
  const merLines = [
    'CUSTOMER ||--o{ ORDER : places',
    'ORDER ||--|{ ORDER_ITEM : has',
    'PRODUCT ||--o{ ORDER_ITEM : in',
  ]
  return (
    <Frame dir="col" w="fill" gap={6} pad={2} align="start">
      <Frame dir="row" gap={6} align="center">
        <Box w={6} h={6} fill="var(--accent)" radius={999} />
        <Text size={9} family="mono" weight={700} color="var(--text-muted)" ls={1.4} nowrap>
          FINAL
        </Text>
      </Frame>
      <Text size={13} lh={20 / 13} w="fill">
        API Gateway 配下に注文・在庫・決済の3サービス。在庫は Saga で結果整合とする。
      </Text>
      <Frame
        dir="col"
        w="fill"
        gap={2}
        pad={[8, 11]}
        radius={6}
        fill="var(--surface)"
        border={[1, 'var(--border)']}
        align="start"
      >
        <Frame dir="row" w="fill" gap={6} align="center">
          <Text size={10.5} family="mono" color="var(--text-muted)" nowrap>
            ```mermaid
          </Text>
          <Spacer />
          <Icon name="copy" size={12} color="var(--text-muted)" />
        </Frame>
        <Text size={10.5} family="mono" weight={600} color="var(--xml)" nowrap>
          erDiagram
        </Text>
        {merLines.map((l) => (
          <Text
            key={l}
            size={10.5}
            family="mono"
            lh={16 / 10.5}
            color="var(--text-secondary)"
            nowrap
          >
            {`  ${l}`}
          </Text>
        ))}
        <Text size={10.5} family="mono" color="var(--text-muted)" nowrap>
          ```
        </Text>
      </Frame>
    </Frame>
  )
}

const PILLS: { label: string; icon: IconName; fill: string; color: string }[] = [
  { label: 'Thinking', icon: 'brain', fill: 'var(--thinking-soft)', color: 'var(--thinking)' },
  { label: 'Tool', icon: 'terminal', fill: 'var(--tool-soft)', color: 'var(--tool)' },
  { label: 'XML', icon: 'code', fill: 'var(--xml-soft)', color: 'var(--xml)' },
  { label: 'Mermaid', icon: 'git-branch', fill: 'var(--surface2)', color: 'var(--xml)' },
  { label: 'Code', icon: 'braces', fill: 'var(--surface2)', color: 'var(--text-secondary)' },
]

function InsertToolbar(): ReactElement {
  return (
    <Frame
      dir="row"
      w="fill"
      gap={7}
      pad={[9, 12]}
      align="center"
      fill="var(--surface)"
      borderSides={{ top: 1 }}
      borderColor="var(--border)"
      clip
    >
      <Icon name="plus" size={18} color="var(--accent)" />
      {PILLS.map((p) => (
        <Frame
          key={p.label}
          dir="row"
          gap={6}
          pad={[8, 12]}
          align="center"
          radius={999}
          fill={p.fill}
        >
          <Icon name={p.icon} size={14} color={p.color} />
          <Text size={12.5} weight={600} color={p.color} nowrap>
            {p.label}
          </Text>
        </Frame>
      ))}
    </Frame>
  )
}

function MobBar(): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={8}
      pad={[10, 14, 6, 14]}
      align="center"
      fill="var(--surface)"
      borderSides={{ top: 1 }}
      borderColor="var(--border)"
    >
      <Frame dir="row" w="fill" gap={10} align="center">
        <Frame
          dir="row"
          gap={6}
          pad={[12, 16]}
          align="center"
          radius={8}
          border={[1, 'var(--border-strong)']}
        >
          <Icon name="activity" size={15} color="var(--text-secondary)" />
          <Text size={13} weight={600} color="var(--text-secondary)" nowrap>
            途中経過
          </Text>
        </Frame>
        <Frame
          dir="row"
          grow
          gap={7}
          pad={[13, 0]}
          justify="center"
          align="center"
          radius={8}
          fill="var(--accent)"
        >
          <Text size={14.5} weight={700} color="var(--on-accent)" nowrap>
            送信
          </Text>
          <Icon name="arrow-up" size={16} color="var(--on-accent)" />
        </Frame>
      </Frame>
      <Box w={134} h={5} fill="var(--border-strong)" radius={999} />
    </Frame>
  )
}
