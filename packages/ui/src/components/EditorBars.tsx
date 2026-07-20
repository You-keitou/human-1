import type { ReactElement, ReactNode } from 'react'
import { Box, Frame, Spacer, Text } from '../ui/primitives'
import { Icon, type IconName } from './Icon'

// EditorCard 上部の Tabs バー(Flow1 / Flow2 / Whiteboard 共通)。design-spec §2.3。
export function EditorTopBar({
  activeTab,
  soonSize = 9,
  right,
}: {
  activeTab: 'raw' | 'whiteboard'
  soonSize?: number
  right: ReactNode
}): ReactElement {
  return (
    <Frame
      dir="row"
      w="fill"
      gap={12}
      pad={[9, 18]}
      align="center"
      borderSides={{ bottom: 1 }}
      borderColor="var(--border)"
    >
      <Frame dir="row" gap={18} align="center">
        <Tab label="Raw output" active={activeTab === 'raw'} />
        <Tab label="Whiteboard" active={activeTab === 'whiteboard'} />
        <Frame dir="row" gap={6} pad={[6, 2]} align="center">
          <Text size={13} color="var(--text-muted)" nowrap>
            Code
          </Text>
          <Frame dir="row" pad={[1, 7]} radius={999} fill="var(--surface2)">
            <Text size={soonSize} family="mono" color="var(--text-muted)" nowrap>
              soon
            </Text>
          </Frame>
        </Frame>
      </Frame>
      <Spacer />
      {right}
    </Frame>
  )
}

function Tab({ label, active }: { label: string; active: boolean }): ReactElement {
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
        color={active ? 'var(--text-primary)' : 'var(--text-muted)'}
        nowrap
      >
        {label}
      </Text>
    </Frame>
  )
}

export function DraftStatus({ dot, text }: { dot: string; text: string }): ReactElement {
  return (
    <Frame dir="row" gap={6} align="center">
      <Box w={6} h={6} fill={dot} radius={999} />
      <Text size={11} family="mono" color="var(--text-muted)" nowrap>
        {text}
      </Text>
    </Frame>
  )
}

const FORMAT_ICONS: IconName[] = ['bold', 'italic', 'strikethrough', 'heading', 'list']

type InsChipDef = { label: string; icon: IconName }
const INS_CHIPS: InsChipDef[] = [
  { label: 'Thinking', icon: 'brain' },
  { label: 'Tool call', icon: 'terminal' },
  { label: 'XML', icon: 'code' },
  { label: 'Mermaid', icon: 'git-branch' },
]

const ACTIVE_CHIP: Record<string, { fill: string; color: string }> = {
  Thinking: { fill: 'var(--thinking-soft)', color: 'var(--thinking)' },
  'Tool call': { fill: 'var(--tool-soft)', color: 'var(--tool)' },
  XML: { fill: 'var(--xml-soft)', color: 'var(--xml)' },
  Mermaid: { fill: 'var(--surface2)', color: 'var(--text-secondary)' },
}

// Format + Insert チップ列。active(Flow2)= 機能色 / inactive(Flow1)= グレー枠。
export function Toolbar({ active, hint }: { active: boolean; hint?: string }): ReactElement {
  const fmtColor = active ? 'var(--text-secondary)' : 'var(--border-strong)'
  return (
    <Frame
      dir="row"
      w="fill"
      gap={10}
      pad={[8, 18]}
      align="center"
      borderSides={{ bottom: 1 }}
      borderColor="var(--border)"
    >
      <Frame dir="row" gap={1} pad={3} radius={6} fill="var(--surface2)" align="center">
        {FORMAT_ICONS.map((ic) => (
          <Frame key={ic} dir="row" pad={[5, 7]} radius={4}>
            <Icon name={ic} size={15} color={fmtColor} />
          </Frame>
        ))}
      </Frame>
      <Box w={1} h={18} fill="var(--border)" />
      {INS_CHIPS.map((chip) => {
        const tone = active ? ACTIVE_CHIP[chip.label] : undefined
        return (
          <Frame
            key={chip.label}
            dir="row"
            gap={6}
            pad={[5, 10]}
            align="center"
            radius={6}
            fill={active ? tone?.fill : 'var(--surface)'}
            border={active ? undefined : [1, 'var(--border)']}
          >
            <Icon
              name={chip.icon}
              size={14}
              color={active ? tone?.color : 'var(--border-strong)'}
            />
            <Text
              size={12}
              weight={600}
              color={active ? tone?.color : 'var(--border-strong)'}
              nowrap
            >
              {chip.label}
            </Text>
          </Frame>
        )
      })}
      <Spacer />
      {hint && (
        <Text size={11} family="mono" color="var(--text-muted)" nowrap>
          {hint}
        </Text>
      )}
    </Frame>
  )
}
