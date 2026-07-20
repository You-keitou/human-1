import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { DotGrid } from '../components/DotGrid'
import { DraftStatus, EditorTopBar } from '../components/EditorBars'
import { Header } from '../components/Header'
import { Icon, type IconName } from '../components/Icon'
import { RequestCard } from '../components/RequestCard'
import { DesktopFrame } from '../components/ScreenFrame'
import { Box, Frame, Spacer, Text } from '../ui/primitives'

// Workspace Whiteboard(`LhRGm`)。Whiteboard タブ・ノード 7 個・Mermaid 挿入可。
export function Whiteboard(): ReactElement {
  return (
    <DesktopFrame>
      <Header active="workspace" epoch={3} avg="8.4" />
      <Frame dir="row" grow w="fill" gap={20} pad={20} align="start">
        <RequestCard timer={{ text: '03:12', tone: 'thinking' }} toolResult />
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
        activeTab="whiteboard"
        soonSize={10}
        right={<DraftStatus dot="var(--tool)" text="ノード 7 · 自動保存" />}
      />
      <Frame dir="col" grow w="fill" clip style={{ position: 'relative' }}>
        <DotGrid />
        <Canvas />
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
          ⌘↵ で送信 · 図は Mermaid として本文に添付
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
        <Frame dir="row" gap={7} pad={[9, 20]} align="center" radius={6} fill="var(--accent)">
          <Text size={13} weight={700} color="var(--on-accent)" nowrap>
            送信
          </Text>
          <Icon name="arrow-up" size={15} color="var(--on-accent)" />
        </Frame>
      </Frame>
    </Frame>
  )
}

function abs(left: number, top: number, z: number): CSSProperties {
  return { position: 'absolute', left, top, zIndex: z }
}

function Canvas(): ReactElement {
  return (
    <>
      <Edge left={400} top={130} w={20} h={84} d="M10 0c7 28-7 56 0 84" z={0} />
      <Edge left={490} top={227} w={120} h={20} d="M0 10c40-8 80 8 120 0" z={1} />
      <Edge left={400} top={260} w={20} h={84} d="M10 0c-7 28 7 56 0 84" z={2} />
      <Edge left={274} top={237} w={56} h={113} d="M0 113c34 0 20-113 56-113" z={3} />

      <EdgeChip left={424} top={162} z={4} label="HTTP" />
      <EdgeChip left={526} top={226} z={5} label="Saga" />
      <EdgeChip left={424} top={292} z={6} label="SQL" />
      <EdgeChip left={284} top={296} z={7} label="1:N" />

      <ServiceNode left={330} top={84} z={8} label="API Gateway" />
      <ServiceNode left={330} top={214} z={9} label="Order Service" />
      <ServiceNode left={610} top={214} z={10} label="Payment Service" />

      <Memo />
      <DbNode />
      <ErEntity />
      <ClassNode />
      <Palette />
      <MermaidBtn />
      <ZoomCtl />
      <MiniMap />
    </>
  )
}

function Edge({
  left,
  top,
  w,
  h,
  d,
  z,
}: {
  left: number
  top: number
  w: number
  h: number
  d: string
  z: number
}): ReactElement {
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ ...abs(left, top, z), overflow: 'visible' }}
      role="img"
      aria-label="connector"
    >
      <title>connector</title>
      <path d={d} stroke="var(--text-muted)" strokeWidth={1.5} fill="none" strokeLinecap="round" />
    </svg>
  )
}

function EdgeChip({
  left,
  top,
  z,
  label,
}: {
  left: number
  top: number
  z: number
  label: string
}): ReactElement {
  return (
    <Frame
      dir="row"
      pad={[2, 8]}
      radius={999}
      fill="var(--surface)"
      border={[1, 'var(--border)']}
      style={abs(left, top, z)}
    >
      <Text size={9} family="mono" color="var(--text-secondary)" nowrap>
        {label}
      </Text>
    </Frame>
  )
}

function ServiceNode({
  left,
  top,
  z,
  label,
}: {
  left: number
  top: number
  z: number
  label: string
}): ReactElement {
  return (
    <Frame
      dir="row"
      w={160}
      h={46}
      justify="center"
      align="center"
      radius={6}
      fill="var(--accent-soft)"
      borderSides={{ left: 2 }}
      borderColor="var(--accent)"
      style={abs(left, top, z)}
    >
      <Text size={12} family="mono" weight={600} nowrap>
        {label}
      </Text>
    </Frame>
  )
}

function Memo(): ReactElement {
  return (
    <Frame
      dir="col"
      w={190}
      pad={[10, 12]}
      radius={6}
      fill="var(--memo-soft)"
      borderSides={{ left: 2 }}
      borderColor="var(--memo)"
      align="start"
      style={{ ...abs(44, 88, 11), transform: 'rotate(-2deg)', transformOrigin: 'top left' }}
    >
      <Text
        size={12}
        family="mono"
        lh={18 / 12}
        color="var(--memo)"
        w="fill"
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {'決済は外部 PSP に委譲。\n在庫は Saga で結果整合。'}
      </Text>
    </Frame>
  )
}

function DbNode(): ReactElement {
  return (
    <div style={{ ...abs(345, 344, 12), width: 130, height: 78 }}>
      <svg
        width={130}
        height={78}
        viewBox="0 0 130 78"
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
        role="img"
        aria-label="database cylinder"
      >
        <title>database cylinder</title>
        <path
          d="M0 11a65 11 0 0 1 130 0l0 56a65 11 0 0 1-130 0z"
          fill="var(--tool-soft)"
          stroke="var(--tool)"
          strokeWidth={1.5}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 130,
          height: 22,
          border: '1.5px solid var(--tool)',
          // 楕円リム: 130×22 では border-radius 999 は角 11px の stadium になり基準(真の楕円)とずれる。
          borderRadius: '50%',
          zIndex: 1,
          boxSizing: 'border-box',
        }}
      />
      {/*
        ラベルは基準(単一 block div · font-size 自身 · text-align center · 絶対 top)に合わせ、
        block レベルの Text にする。inline span のままだと w='fill'/text-align が効かず左寄せになり、
        ラッパ div の継承 font-size(16px)で strut が伸びて縦にもずれる。
      */}
      <Text
        size={11}
        family="mono"
        weight={600}
        align="center"
        w="fill"
        style={{ position: 'absolute', left: 0, top: 36, zIndex: 2, display: 'block' }}
      >
        orders-db
      </Text>
      <Text
        size={9}
        family="mono"
        color="var(--tool)"
        align="center"
        w="fill"
        style={{ position: 'absolute', left: 0, top: 52, zIndex: 3, display: 'block' }}
      >
        PostgreSQL
      </Text>
    </div>
  )
}

function CardNode({
  left,
  top,
  z,
  w,
  borderColor,
  headFill,
  title,
  titleColor,
  tag,
  rows,
}: {
  left: number
  top: number
  z: number
  w: number
  borderColor: string
  headFill: string
  title: string
  titleColor: string
  tag: string
  rows: ReactNode
}): ReactElement {
  return (
    <Frame
      dir="col"
      w={w}
      radius={6}
      fill="var(--surface)"
      border={[1.5, borderColor]}
      clip
      align="start"
      style={abs(left, top, z)}
    >
      <Frame dir="row" w="fill" gap={8} pad={[6, 10]} align="center" fill={headFill}>
        <Text size={11} family="mono" weight={600} color={titleColor} nowrap>
          {title}
        </Text>
        <Spacer />
        <Text size={9} family="mono" color="var(--text-muted)" nowrap>
          {tag}
        </Text>
      </Frame>
      {rows}
    </Frame>
  )
}

function ErEntity(): ReactElement {
  const rows: [string, string][] = [
    ['id', 'uuid PK'],
    ['user_id', 'uuid FK'],
    ['status', 'enum'],
    ['total', 'int'],
  ]
  return (
    <CardNode
      left={64}
      top={300}
      z={13}
      w={210}
      borderColor="var(--xml)"
      headFill="var(--xml-soft)"
      title="orders"
      titleColor="var(--xml)"
      tag="entity"
      rows={rows.map(([field, type]) => (
        <Frame
          key={field}
          dir="row"
          w="fill"
          gap={8}
          pad={[4, 10]}
          align="center"
          borderSides={{ top: 1 }}
          borderColor="var(--border)"
        >
          <Text size={11} family="mono" nowrap>
            {field}
          </Text>
          <Spacer />
          <Text size={10} family="mono" color="var(--text-muted)" nowrap>
            {type}
          </Text>
        </Frame>
      ))}
    />
  )
}

function ClassNode(): ReactElement {
  const methods = ['+ start(order)', '+ reserveStock()', '+ capturePayment()']
  return (
    <CardNode
      left={640}
      top={344}
      z={14}
      w={220}
      borderColor="var(--thinking)"
      headFill="var(--thinking-soft)"
      title="OrderSaga"
      titleColor="var(--thinking)"
      tag="class"
      rows={methods.map((m) => (
        <Frame
          key={m}
          dir="row"
          w="fill"
          pad={[4, 10]}
          borderSides={{ top: 1 }}
          borderColor="var(--border)"
        >
          <Text size={11} family="mono" color="var(--text-secondary)" nowrap>
            {m}
          </Text>
        </Frame>
      ))}
    />
  )
}

const PALETTE: { label: string; icon: IconName; active?: boolean }[] = [
  { label: '付箋', icon: 'sticky-note' },
  { label: 'サービス', icon: 'box', active: true },
  { label: 'DB', icon: 'database' },
  { label: 'ER', icon: 'table' },
  { label: 'クラス', icon: 'braces' },
]

function Palette(): ReactElement {
  return (
    <Frame
      dir="row"
      gap={2}
      pad={4}
      align="center"
      radius={8}
      fill="var(--surface)"
      border={[1, 'var(--border-strong)']}
      style={{ ...abs(16, 14, 15), boxShadow: '0px 10px 24px -6px #3A2C1526' }}
    >
      {PALETTE.map((p) => {
        const color = p.active ? 'var(--accent-strong)' : 'var(--text-secondary)'
        return (
          <Frame
            key={p.label}
            dir="row"
            gap={6}
            pad={[5, 10]}
            align="center"
            radius={6}
            fill={p.active ? 'var(--accent-soft)' : undefined}
          >
            <Icon name={p.icon} size={13} color={color} />
            <Text size={12} weight={p.active ? 600 : 400} color={color} nowrap>
              {p.label}
            </Text>
          </Frame>
        )
      })}
      <Box w={1} h={18} fill="var(--border)" />
      <Frame dir="row" gap={6} pad={[5, 10]} align="center" radius={6}>
        <Icon name="spline" size={13} color="var(--text-secondary)" />
        <Text size={12} color="var(--text-secondary)" nowrap>
          接続
        </Text>
      </Frame>
    </Frame>
  )
}

function MermaidBtn(): ReactElement {
  return (
    <Frame
      dir="row"
      gap={7}
      pad={[8, 14]}
      align="center"
      radius={6}
      fill="var(--accent)"
      style={abs(757, 16, 16)}
    >
      <Icon name="git-branch" size={14} color="var(--on-accent)" />
      <Text size={12} weight={600} color="var(--on-accent)" nowrap>
        Mermaid として挿入
      </Text>
    </Frame>
  )
}

function ZoomCtl(): ReactElement {
  return (
    <Frame
      dir="row"
      gap={10}
      pad={[4, 10]}
      align="center"
      radius={6}
      fill="var(--surface)"
      border={[1, 'var(--border)']}
      style={abs(16, 649, 17)}
    >
      {['−', '100%', '+'].map((t) => (
        <Text key={t} size={11} family="mono" color="var(--text-secondary)" nowrap>
          {t}
        </Text>
      ))}
    </Frame>
  )
}

function MiniMap(): ReactElement {
  const rects: [number, number, number, number, string][] = [
    [56, 12, 24, 9, 'var(--accent)'],
    [56, 34, 24, 9, 'var(--accent)'],
    [96, 34, 24, 9, 'var(--accent)'],
    [58, 54, 20, 10, 'var(--tool)'],
    [14, 48, 26, 13, 'var(--xml)'],
    [100, 56, 28, 13, 'var(--thinking)'],
    [12, 10, 20, 12, 'var(--memo-soft)'],
  ]
  return (
    <div
      style={{
        ...abs(774, 577, 18),
        width: 150,
        height: 96,
        background: 'var(--surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 8,
        boxShadow: '0px 10px 24px -6px #3A2C1526',
        boxSizing: 'border-box',
      }}
    >
      {rects.map(([l, t, w, h, c], i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: l,
            top: t,
            width: w,
            height: h,
            background: c,
            borderRadius: 1,
          }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          left: 44,
          top: 6,
          width: 76,
          height: 60,
          border: '1px solid var(--accent-strong)',
          borderRadius: 2,
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}
