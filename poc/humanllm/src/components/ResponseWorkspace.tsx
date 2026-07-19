import { useRef, useState } from 'react'
import type { ToolInfo } from '../../shared/types'
import { RichResponseInput, type ParsedTurn } from './RichResponseInput'
import { DiagramEditor } from './DiagramEditor'

// 回答ワークスペース: Raw output(tiptap)と Diagram(React Flow)をタブで切り替える。
// 将来はここに code editor タブも足す。
type Props = {
  tools: ToolInfo[]
  requestCreatedAt: number
  disabled: boolean
  onSendTurn: (parsed: ParsedTurn) => void
  onProgress: (parsed: ParsedTurn) => void
}

export function ResponseWorkspace(props: Props) {
  const [tab, setTab] = useState<'editor' | 'diagram'>('editor')
  const insertRef = useRef<((text: string) => void) | null>(null)

  return (
    <div className="response-workspace">
      <div className="workspace-tabs">
        <button
          className={`workspace-tab${tab === 'editor' ? ' active' : ''}`}
          onClick={() => setTab('editor')}
        >
          Raw output
        </button>
        <button
          className={`workspace-tab${tab === 'diagram' ? ' active' : ''}`}
          onClick={() => setTab('diagram')}
        >
          Diagram
        </button>
        <span className="workspace-tabs-note">code editor: coming soon</span>
      </div>
      <div className={`workspace-pane${tab === 'editor' ? '' : ' hidden'}`}>
        <RichResponseInput
          {...props}
          onEditorReady={(insert) => { insertRef.current = insert }}
        />
      </div>
      <div className={`workspace-pane${tab === 'diagram' ? '' : ' hidden'}`}>
        <DiagramEditor
          onInsertMermaid={(code) => {
            insertRef.current?.(code)
            setTab('editor')
          }}
        />
      </div>
    </div>
  )
}
