import type { ReactElement, ReactNode } from 'react'
import { Frame } from '../ui/primitives'

// Desktop 画面ルート(1440×900, 矩形, bg, clip)。
export function DesktopFrame({ children }: { children: ReactNode }): ReactElement {
  return (
    <Frame dir="col" w={1440} h={900} fill="var(--bg)" clip>
      {children}
    </Frame>
  )
}

// Mobile 画面ルート(390×844, 端末角丸 28, bg, clip)。
export function MobileFrame({ children }: { children: ReactNode }): ReactElement {
  return (
    <Frame dir="col" w={390} h={844} fill="var(--bg)" radius={28} clip>
      {children}
    </Frame>
  )
}
