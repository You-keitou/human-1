import type { ReactElement } from 'react'
import { LiveRuns } from './app/LiveRuns'
import { TokenGate } from './app/TokenGate'
import { Workspace } from './app/Workspace'
import { Flow1Step1 } from './screens/Flow1Step1'
import { Flow2Step2 } from './screens/Flow2Step2'
import { MobileAnswer } from './screens/MobileAnswer'
import { MobileStep2 } from './screens/MobileStep2'
import { Runs } from './screens/Runs'
import { Whiteboard } from './screens/Whiteboard'

// 手書きルータ。
//  - /preview/<slug> … fixture 駆動の決定的な静的 6 画面(px ゲート)。トークン不要。
//  - / , /whiteboard , /runs … 実アプリ(TokenGate → WS/エディタ/whiteboard/Runs)。
// preview 分岐を先に評価するため、px 検証はトークンゲートに阻まれない。
const PREVIEW: Record<string, () => ReactElement> = {
  'flow1-step1': Flow1Step1,
  'flow2-step2': Flow2Step2,
  whiteboard: Whiteboard,
  runs: () => <Runs />,
  'mobile-answer': MobileAnswer,
  'mobile-step2': MobileStep2,
}

export function App(): ReactElement {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

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

  if (path === '/runs') {
    return <TokenGate>{(token) => <LiveRuns token={token} />}</TokenGate>
  }
  if (path === '/whiteboard') {
    return <TokenGate>{(token) => <Workspace token={token} tab="whiteboard" />}</TokenGate>
  }
  // 既定(/ 含む)はワークスペース。
  return <TokenGate>{(token) => <Workspace token={token} tab="raw" />}</TokenGate>
}
