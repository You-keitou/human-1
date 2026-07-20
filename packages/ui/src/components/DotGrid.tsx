import { type ReactElement, useLayoutEffect, useRef } from 'react'

// design/dotgrid.glsl の canvas 2D 移植。フラグメントシェーダの式をそのまま
// デバイスピクセルで評価する(WebGL のコンテキスト差に依存せず決定的)。
//   cell = mod(frag, spacing); dist = |cell - spacing/2|
//   dot  = 1 - smoothstep(r, r+1.2, dist)
//   color = mix(bg, dotColor, dot * 0.55)
// uniforms: spacing 24 / dot #CFC4AD / bg #FCFAF5 / radius 1.1(すべて CSS px、dpr 倍で device 化)。
//
// 判断理由: 第 2 段で React Flow の背景に置き換わる前提のため、WebGL 依存を避け、
// 参照 PNG(Pencil が同シェーダを 2x でラスタライズ)と同じ device 出力を canvas で再現する。

const SPACING = 24
const RADIUS = 1.1
const FALLOFF = 1.2
const BG: [number, number, number] = [252, 250, 245] // #FCFAF5
const DOT: [number, number, number] = [207, 196, 173] // #CFC4AD
const BLEND = 0.55

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function DotGrid(): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(rect.width * dpr)
    const h = Math.round(rect.height * dpr)
    canvas.width = w
    canvas.height = h
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const spacing = SPACING * dpr
    const center = spacing * 0.5
    const r = RADIUS * dpr
    const rEnd = (RADIUS + FALLOFF) * dpr

    const img = ctx.createImageData(w, h)
    const data = img.data
    for (let y = 0; y < h; y++) {
      const cy = (y % spacing) - center
      for (let x = 0; x < w; x++) {
        const cx = (x % spacing) - center
        const dist = Math.sqrt(cx * cx + cy * cy)
        const dot = (1 - smoothstep(r, rEnd, dist)) * BLEND
        const i = (y * w + x) * 4
        data[i] = BG[0] + (DOT[0] - BG[0]) * dot
        data[i + 1] = BG[1] + (DOT[1] - BG[1]) * dot
        data[i + 2] = BG[2] + (DOT[2] - BG[2]) * dot
        data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [])

  return (
    <canvas ref={ref} style={{ position: 'absolute', inset: 0, zIndex: 0, display: 'block' }} />
  )
}
