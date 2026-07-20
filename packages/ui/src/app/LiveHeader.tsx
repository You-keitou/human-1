import type { ReactElement } from 'react'
import { useIsMobile } from '../lib/useMedia'
import type { WsStatus } from '../lib/useWebSocket'
import { Box, Frame, Spacer, Text } from '../ui/primitives'

// live ルート用ヘッダ。静的 Header と同トーンだが、ナビは実リンク(<a>)・状態は WS 接続状態を反映。
// preview の Header は不変(px ゲート)なので別実装にしている。

const STATUS: Record<WsStatus, { label: string; color: string }> = {
  open: { label: 'live', color: 'var(--tool)' },
  connecting: { label: 'connecting', color: 'var(--warn)' },
  closed: { label: 'offline', color: 'var(--text-muted)' },
}

export function LiveHeader(props: {
  active: 'workspace' | 'runs'
  status: WsStatus
  epoch: number
  avg: string
}): ReactElement {
  // モバイル幅(640px 以下)ではデスクトップの単一 row(ナビ3+指標)が 390px を超えて横溢れする。
  // design の Mobile 系ヘッダ(MobHeader / M-Header)に沿ったコンパクト構成へ折りたたむ。
  const isMobile = useIsMobile()
  return isMobile ? <MobileHeader {...props} /> : <DesktopHeader {...props} />
}

function DesktopHeader({
  active,
  status,
  epoch,
  avg,
}: {
  active: 'workspace' | 'runs'
  status: WsStatus
  epoch: number
  avg: string
}): ReactElement {
  const st = STATUS[status]
  return (
    <Frame
      dir="row"
      w="fill"
      h={64}
      gap={26}
      pad={[0, 28]}
      align="center"
      borderSides={{ bottom: 1 }}
      borderColor="var(--border)"
      style={{ flexShrink: 0 }}
    >
      <Frame dir="row" gap={9} align="center">
        <Box w={9} h={9} fill="var(--accent)" radius={999} />
        <Text size={19} family="display" weight={600} nowrap>
          human-1
        </Text>
        <Text size={11} family="mono" color="var(--text-muted)" nowrap>
          train
        </Text>
      </Frame>

      <Frame dir="row" gap={18} align="center">
        <NavLink href="/" label="Workspace" active={active === 'workspace'} />
        <NavLink href="/runs" label="Runs" active={active === 'runs'} />
        <NavLink href="/whiteboard" label="Whiteboard" active={false} />
      </Frame>

      <Spacer />

      <Frame dir="row" gap={6} align="center">
        <Text size={11} family="mono" color="var(--text-muted)" nowrap>
          answered
        </Text>
        <Text size={15} family="display" weight={600} color="var(--xml)" nowrap>
          {epoch}
        </Text>
      </Frame>

      <Frame dir="row" gap={6} align="center">
        <Text size={11} family="mono" color="var(--text-muted)" nowrap>
          avg
        </Text>
        <Text size={17} family="display" weight={600} color="var(--xml)" nowrap>
          {avg}
        </Text>
        <Text size={11} family="mono" color="var(--text-muted)" nowrap>
          /10
        </Text>
      </Frame>

      <Frame dir="row" gap={7} align="center">
        <Box w={8} h={8} fill={st.color} radius={999} />
        <Text size={11} family="mono" color="var(--text-muted)" nowrap>
          {st.label}
        </Text>
      </Frame>
    </Frame>
  )
}

// design MobHeader / M-Header 相当のコンパクトヘッダ。ナビ・指標を畳み、logo + train +
// ステータス(live)のみを残して 390px に収める(横溢れゼロ)。ナビはワークスペース内タブ/
// リンクで代替する前提。
function MobileHeader({
  status,
  epoch,
  avg,
}: {
  active: 'workspace' | 'runs'
  status: WsStatus
  epoch: number
  avg: string
}): ReactElement {
  const st = STATUS[status]
  return (
    <Frame
      dir="row"
      w="fill"
      gap={8}
      pad={[12, 16]}
      align="center"
      borderSides={{ bottom: 1 }}
      borderColor="var(--border)"
      style={{ flexShrink: 0 }}
    >
      <Box w={9} h={9} fill="var(--accent)" radius={999} />
      <Text size={17} family="display" weight={600} nowrap>
        human-1
      </Text>
      <Text size={10.5} family="mono" color="var(--text-muted)" nowrap>
        train
      </Text>
      <Spacer />
      <Text size={11} family="mono" color="var(--text-muted)" nowrap>
        {epoch}·{avg}
      </Text>
      <Frame dir="row" gap={5} align="center">
        <Box w={8} h={8} fill={st.color} radius={999} />
        <Text size={10.5} family="mono" color="var(--text-muted)" nowrap>
          {st.label}
        </Text>
      </Frame>
    </Frame>
  )
}

function NavLink({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active: boolean
}): ReactElement {
  return (
    <a
      href={href}
      style={{
        textDecoration: 'none',
        padding: '6px 2px',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        fontFamily: 'var(--font-ui)',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </a>
  )
}
