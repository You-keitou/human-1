import {
  Activity,
  ArrowRight,
  ArrowUp,
  Bold,
  Box as BoxIcon,
  Braces,
  Brain,
  Check,
  ChevronDown,
  Code,
  Copy,
  CornerDownRight,
  Database,
  Diff,
  GitBranch,
  GripVertical,
  Heading,
  Image as ImageIcon,
  Inbox,
  Italic,
  List,
  LoaderCircle,
  type LucideIcon,
  Plus,
  Search,
  Spline,
  StickyNote,
  Strikethrough,
  Table,
  Terminal,
  Zap,
} from 'lucide-react'
import type { ReactElement } from 'react'

// Pencil の lucide アイコン(data-icon-set="lucide")を lucide-react で再現。
// name はデザイン実測の data-icon-name(kebab)に対応。
const MAP = {
  brain: Brain,
  terminal: Terminal,
  search: Search,
  diff: Diff,
  image: ImageIcon,
  bold: Bold,
  italic: Italic,
  strikethrough: Strikethrough,
  heading: Heading,
  list: List,
  code: Code,
  'git-branch': GitBranch,
  'loader-circle': LoaderCircle,
  check: Check,
  zap: Zap,
  inbox: Inbox,
  'corner-down-right': CornerDownRight,
  activity: Activity,
  'arrow-up': ArrowUp,
  'arrow-right': ArrowRight,
  'sticky-note': StickyNote,
  box: BoxIcon,
  database: Database,
  table: Table,
  braces: Braces,
  spline: Spline,
  'grip-vertical': GripVertical,
  copy: Copy,
  plus: Plus,
  'chevron-down': ChevronDown,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof MAP

export function Icon({
  name,
  size,
  color = 'currentColor',
  opacity,
}: {
  name: IconName
  size: number
  color?: string
  opacity?: number
}): ReactElement {
  const Cmp = MAP[name]
  return (
    <Cmp
      size={size}
      color={color}
      opacity={opacity}
      strokeWidth={2}
      style={{ flexShrink: 0, display: 'block' }}
    />
  )
}
