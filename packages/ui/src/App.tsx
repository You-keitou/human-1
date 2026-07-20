import type { ReactElement } from 'react'
import { Flow1Step1 } from './screens/Flow1Step1'
import { Flow2Step2 } from './screens/Flow2Step2'
import { MobileAnswer } from './screens/MobileAnswer'
import { MobileStep2 } from './screens/MobileStep2'
import { Runs } from './screens/Runs'
import { Whiteboard } from './screens/Whiteboard'

// 軽量な手書きルータ。第 1 段では /preview/<slug> の 6 ルートを fixture 駆動で
// 決定的に描画する。本流ルート(/ 等)はプレースホルダ(既存 e2e スモークを維持)。
const PREVIEW: Record<string, () => ReactElement> = {
  'flow1-step1': Flow1Step1,
  'flow2-step2': Flow2Step2,
  whiteboard: Whiteboard,
  runs: Runs,
  'mobile-answer': MobileAnswer,
  'mobile-step2': MobileStep2,
}

export function App(): ReactElement {
  const path = window.location.pathname.replace(/\/+$/, '')
  const previewMatch = path.match(/^\/preview\/(.+)$/)
  if (previewMatch) {
    const Screen = PREVIEW[previewMatch[1] ?? '']
    if (Screen) {
      return (
        <div className="preview-host">
          <Screen />
        </div>
      )
    }
  }
  return <Placeholder />
}

// 本流のプレースホルダ。e2e スモーク(title / app-title / app-root)を壊さない。
function Placeholder(): ReactElement {
  return (
    <div style={{ padding: 40, fontFamily: 'var(--font-display)' }}>
      <h1 data-testid="app-title" style={{ fontWeight: 600 }}>
        human-1
      </h1>
      <p style={{ fontFamily: 'var(--font-ui)', color: 'var(--text-secondary)' }}>
        訓練環境 UI。プレビュー:{' '}
        {Object.keys(PREVIEW).map((slug) => (
          <a key={slug} href={`/preview/${slug}`} style={{ marginRight: 12 }}>
            {slug}
          </a>
        ))}
      </p>
    </div>
  )
}
