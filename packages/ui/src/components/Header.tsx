import type { ReactElement } from 'react'
import { Box, Frame, Spacer, Text } from '../ui/primitives'

export type HeaderData = {
  active: 'workspace' | 'runs'
  epoch: number
  avg: string
}

// Desktop 共通ヘッダ(Flow1 / Flow2 / Whiteboard / Runs)。design-spec §2.1。
// active ラベル色は mock 実測に従う: workspace=text-primary / runs=accent。
export function Header({ active, epoch, avg }: HeaderData): ReactElement {
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
        <NavItem label="Workspace" active={active === 'workspace'} />
        <NavItem label="Runs" active={active === 'runs'} />
      </Frame>

      <Spacer />

      <Frame
        dir="row"
        gap={7}
        pad={[6, 12]}
        align="center"
        radius={999}
        border={[1, 'var(--border-strong)']}
      >
        <Box w={7} h={7} fill="var(--accent)" radius={999} />
        <Text size={12} weight={600} color="var(--text-secondary)" nowrap>
          Training · epoch {epoch}
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
        <Box w={8} h={8} fill="var(--tool)" radius={999} />
        <Text size={11} family="mono" color="var(--text-muted)" nowrap>
          live
        </Text>
      </Frame>
    </Frame>
  )
}

function NavItem({ label, active }: { label: string; active: boolean }): ReactElement {
  const activeColor = label === 'Runs' ? 'var(--accent)' : 'var(--text-primary)'
  return (
    <Frame
      dir="row"
      pad={[6, 2]}
      borderSides={active ? { bottom: 2 } : undefined}
      borderColor="var(--accent)"
    >
      <Text
        size={13}
        weight={active ? 600 : 400}
        color={active ? activeColor : 'var(--text-muted)'}
        nowrap
      >
        {label}
      </Text>
    </Frame>
  )
}
