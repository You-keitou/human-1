import type { CSSProperties, ReactNode } from 'react'

// Pencil のフレックス frame / text ノードを 1:1 で写した最小プリミティブ。
// 第 1 段の px 一致と、第 2 段でそのまま使える素直な構造の両方を担う。

export type Sizing = number | 'fill' | 'fit'
type Pad = number | [number, number] | [number, number, number, number]
type Radius = number | [number, number, number, number]
type Sides = Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>

const JUSTIFY = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
} as const
const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end' } as const

function sizeVal(v: Sizing | undefined): string | undefined {
  if (v === undefined) return undefined
  if (v === 'fill') return '100%'
  if (v === 'fit') return 'fit-content'
  return `${v}px`
}

function padVal(p: Pad | undefined): string | undefined {
  if (p === undefined) return undefined
  if (typeof p === 'number') return `${p}px`
  if (p.length === 2) return `${p[0]}px ${p[1]}px`
  return `${p[0]}px ${p[1]}px ${p[2]}px ${p[3]}px`
}

function radiusVal(r: Radius | undefined): string | undefined {
  if (r === undefined) return undefined
  if (typeof r === 'number') return `${r}px`
  return `${r[0]}px ${r[1]}px ${r[2]}px ${r[3]}px`
}

export type FrameProps = {
  dir?: 'row' | 'col'
  gap?: number
  pad?: Pad
  justify?: keyof typeof JUSTIFY
  align?: keyof typeof ALIGN
  w?: Sizing
  h?: Sizing
  grow?: boolean
  fill?: string
  radius?: Radius
  /** 均一ボーダー: [幅, 色] */
  border?: [number, string]
  /** 辺別ボーダー幅 + 色 */
  borderSides?: Sides
  borderColor?: string
  clip?: boolean
  shadow?: string
  rotate?: number
  style?: CSSProperties
  className?: string
  children?: ReactNode
}

export function Frame(props: FrameProps): React.ReactElement {
  const {
    dir = 'row',
    gap,
    pad,
    justify,
    align,
    w,
    h,
    grow,
    fill,
    radius,
    border,
    borderSides,
    borderColor,
    clip,
    shadow,
    rotate,
    style,
    className,
    children,
  } = props

  // grow は「親のフレックス軸に沿って伸びる(flex:1 1 0)」だけを意味する。
  // 主軸/交差軸の寸法は常に明示 w/h を尊重する(親の向きに依存しない)。
  const s: CSSProperties = {
    display: 'flex',
    flexDirection: dir === 'row' ? 'row' : 'column',
    flexShrink: grow ? undefined : 0,
    boxSizing: 'border-box',
    gap: gap === undefined ? undefined : `${gap}px`,
    padding: padVal(pad),
    justifyContent: justify ? JUSTIFY[justify] : undefined,
    alignItems: align ? ALIGN[align] : undefined,
    width: sizeVal(w),
    height: sizeVal(h),
    flex: grow ? '1 1 0' : undefined,
    minWidth: grow ? 0 : undefined,
    minHeight: grow ? 0 : undefined,
    background: fill,
    borderRadius: radiusVal(radius),
    overflow: clip ? 'hidden' : undefined,
    boxShadow: shadow,
    ...style,
  }
  if (border) {
    s.border = `${border[0]}px solid ${border[1]}`
  }
  if (borderSides) {
    const col = borderColor ?? 'var(--border)'
    s.borderStyle = 'solid'
    s.borderColor = col
    s.borderTopWidth = `${borderSides.top ?? 0}px`
    s.borderRightWidth = `${borderSides.right ?? 0}px`
    s.borderBottomWidth = `${borderSides.bottom ?? 0}px`
    s.borderLeftWidth = `${borderSides.left ?? 0}px`
  }
  if (rotate !== undefined) {
    s.transform = `rotate(${rotate}deg)`
    s.transformOrigin = 'top left'
  }
  return (
    <div className={className} style={s}>
      {children}
    </div>
  )
}

export type TextProps = {
  size: number
  family?: 'mono' | 'ui' | 'display'
  weight?: 400 | 500 | 600 | 700
  color?: string
  ls?: number
  /** 行高(倍率)。既定は font の normal。 */
  lh?: number | 'normal'
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  nowrap?: boolean
  /** 折り返し用の固定幅 */
  w?: Sizing
  grow?: boolean
  style?: CSSProperties
  children?: ReactNode
}

const FAMILY = {
  mono: 'var(--font-mono)',
  ui: 'var(--font-ui)',
  display: 'var(--font-display)',
} as const

export function Text(props: TextProps): React.ReactElement {
  const {
    size,
    family = 'ui',
    weight = 400,
    color = 'var(--text-primary)',
    ls,
    lh = 'normal',
    italic,
    align,
    nowrap,
    w,
    grow,
    style,
    children,
  } = props
  const s: CSSProperties = {
    fontFamily: FAMILY[family],
    fontSize: `${size}px`,
    fontWeight: weight,
    color,
    letterSpacing: ls === undefined ? undefined : `${ls}px`,
    lineHeight: lh === 'normal' ? 'normal' : lh,
    fontStyle: italic ? 'italic' : undefined,
    textAlign: align,
    whiteSpace: nowrap ? 'nowrap' : undefined,
    width: grow ? undefined : sizeVal(w),
    flex: grow ? '1 1 0' : undefined,
    minWidth: grow ? 0 : undefined,
    boxSizing: 'border-box',
    margin: 0,
    ...style,
  }
  return <span style={s}>{children}</span>
}

/** 伸縮スペーサ(Pencil の HeaderSpacer 等)。 */
export function Spacer(): React.ReactElement {
  return <div style={{ flex: '1 1 0', height: 1 }} />
}

/** 単色の矩形(ドット・バー・区切り線)。 */
export function Box(props: {
  w?: Sizing
  h?: Sizing
  fill?: string
  radius?: Radius
  grow?: boolean
  style?: CSSProperties
}): React.ReactElement {
  const { w, h, fill, radius, grow, style } = props
  return (
    <div
      style={{
        width: sizeVal(w),
        height: sizeVal(h),
        background: fill,
        borderRadius: radiusVal(radius),
        flexShrink: 0,
        flex: grow ? '1 1 0' : undefined,
        boxSizing: 'border-box',
        ...style,
      }}
    />
  )
}
