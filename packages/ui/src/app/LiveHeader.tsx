import type { ReactElement } from 'react'
import { useIsMobile } from '../lib/useMedia'
import type { WsStatus } from '../lib/useWebSocket'
import { Box, Frame, Spacer, Text } from '../ui/primitives'
import { LIVE_GUTTER, LiveHeaderShell } from './liveLayout'
import { ThemeSwitcher } from './ThemeSwitcher'

// live ルート用ヘッダ。静的 Header と同トーンだが、ナビは実リンク(<a>)・状態は WS 接続状態を反映。
// preview の Header は不変(px ゲート)なので別実装にしている。
// 中身は max-width コンテナで中央寄せ(LiveHeaderShell)。answered/status はコンテキストにより省略可。

const STATUS: Record<WsStatus, { label: string; color: string }> = {
  open: { label: 'live', color: 'var(--tool)' },
  connecting: { label: 'connecting', color: 'var(--warn)' },
  closed: { label: 'offline', color: 'var(--text-muted)' },
}

type LiveHeaderProps = {
  active: 'workspace' | 'runs'
  // WS を張らない /runs では status/epoch は省略(answered/live チップを出さない)。
  status?: WsStatus
  epoch?: number
  avg: string
}

export function LiveHeader(props: LiveHeaderProps): ReactElement {
  // モバイル幅(640px 以下)ではデスクトップの単一 row(ナビ3+指標)が 390px を超えて横溢れする。
  // design の Mobile 系ヘッダ(MobHeader / M-Header)に沿ったコンパクト構成へ折りたたむ。
  const isMobile = useIsMobile()
  return (
    <LiveHeaderShell>
      {isMobile ? <MobileHeader {...props} /> : <DesktopHeader {...props} />}
    </LiveHeaderShell>
  )
}

function DesktopHeader({ active, status, epoch, avg }: LiveHeaderProps): ReactElement {
  const st = status ? STATUS[status] : null
  return (
    <Frame dir="row" w="fill" h={64} gap={20} pad={[0, LIVE_GUTTER]} align="center">
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
      </Frame>

      <Spacer />

      {epoch !== undefined && (
        <Frame dir="row" gap={6} align="center">
          <Text size={11} family="mono" color="var(--text-muted)" nowrap>
            answered
          </Text>
          <Text size={15} family="display" weight={600} color="var(--xml)" nowrap>
            {epoch}
          </Text>
        </Frame>
      )}

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

      {st && (
        <Frame dir="row" gap={7} align="center">
          <Box w={8} h={8} fill={st.color} radius={999} />
          <Text size={11} family="mono" color="var(--text-muted)" nowrap>
            {st.label}
          </Text>
        </Frame>
      )}

      <ThemeSwitcher />
    </Frame>
  )
}

// design MobHeader / M-Header 相当のコンパクトヘッダ。ナビ・指標を畳み、logo + train +
// テーマスイッチャ + ステータス(live)のみを残して 390px に収める(横溢れゼロ)。
function MobileHeader({ active, status, epoch, avg }: LiveHeaderProps): ReactElement {
  const st = status ? STATUS[status] : null
  return (
    <Frame dir="row" w="fill" gap={8} pad={[12, 12]} align="center">
      <Box w={9} h={9} fill="var(--accent)" radius={999} />
      <Text size={17} family="display" weight={600} nowrap>
        human-1
      </Text>
      {/* モバイルはヘッダーからナビを畳むため、Runs⇄Workspace の行き来をコンパクトなリンクで残す。 */}
      <a
        href={active === 'runs' ? '/' : '/runs'}
        style={{
          textDecoration: 'none',
          fontFamily: 'var(--font-ui)',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
        }}
      >
        {active === 'runs' ? 'Workspace' : 'Runs'}
      </a>
      <Spacer />
      <Text size={10.5} family="mono" color="var(--text-muted)" nowrap>
        {epoch !== undefined ? `${epoch}·${avg}` : avg}
      </Text>
      {st && (
        <Frame dir="row" gap={4} align="center">
          <Box w={8} h={8} fill={st.color} radius={999} />
          <Text size={10.5} family="mono" color="var(--text-muted)" nowrap>
            {st.label}
          </Text>
        </Frame>
      )}
      <ThemeSwitcher compact />
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
