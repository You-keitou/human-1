import { type ReactElement, useEffect, useRef } from 'react'

// React Flow の背景ドットグリッド。design/dotgrid.glsl のフラグメント式を canvas 2D で評価する。
//   cell = mod(frag, spacing); dist = |cell - spacing/2|
//   dot  = 1 - smoothstep(r, r+1.2, dist); color = mix(bg, dot, dot*0.55)
// codex 指摘の origin 補正: GLSL の gl_FragCoord は左下原点・ピクセル中心サンプルなので、
// canvas(左上原点)では frag = (x + 0.5, h - y - 0.5) で評価する。ResizeObserver で追従する。

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

export function DotGridBackground(): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const paint = (): void => {
      const rect = parent.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
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
        // origin 補正: フラグメント Y は下から数える(h - y - 0.5)。
        const fy = h - y - 0.5
        const cy = (((fy % spacing) + spacing) % spacing) - center
        for (let x = 0; x < w; x++) {
          const fx = x + 0.5
          const cx = (((fx % spacing) + spacing) % spacing) - center
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
    }

    paint()
    const ro = new ResizeObserver(() => paint())
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  // aria-hidden は装飾ラッパ div 側に置く(canvas 直付けは a11y lint に触れるため)。
  return (
    <div
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}
    >
      <canvas ref={ref} style={{ display: 'block' }} />
    </div>
  )
}
