import type { ReactNode } from 'react'
import type { ChatMessage } from '../../shared/types'

type Props = {
  messages: ChatMessage[]
}

const roleLabel: Record<ChatMessage['role'], string> = {
  system: '🔧 system',
  user: '👤 user',
  assistant: '🤖 assistant',
}

// 折りたたむ長さのしきい値
const COLLAPSE_THRESHOLD = 600

// XML タグと [marker] を色付けして整形する
function formatContent(text: string): ReactNode[] {
  const parts = text.split(/(<\/?[a-zA-Z][a-zA-Z0-9_:-]*(?:\s[^<>]*?)?>|\[[a-zA-Z_][a-zA-Z0-9_ :-]*\])/g)
  return parts.map((part, i) => {
    if (/^<\/?[a-zA-Z]/.test(part)) {
      return <span key={i} className="fmt-xml-tag">{part}</span>
    }
    if (/^\[[a-zA-Z_]/.test(part)) {
      return <span key={i} className="fmt-marker">{part}</span>
    }
    return part
  })
}

function summarize(text: string): string {
  const line = text.trim().split('\n')[0]
  return line.length > 80 ? line.slice(0, 80) + '…' : line
}

export function PromptDisplay({ messages }: Props) {
  return (
    <div className="prompt-display">
      {messages.map((msg, i) => {
        const isLong = msg.content.length > COLLAPSE_THRESHOLD
        const isLast = i === messages.length - 1
        const body = (
          <pre className="message-content">{formatContent(msg.content)}</pre>
        )
        return (
          <div key={i} className={`message message-${msg.role}`}>
            <div className="message-role">{roleLabel[msg.role]}</div>
            {isLong && !isLast ? (
              <details className="message-collapse">
                <summary>
                  <span className="fmt-collapsed-hint">{summarize(msg.content)}</span>
                  <span className="fmt-collapsed-size">({(msg.content.length / 1000).toFixed(1)}k chars)</span>
                </summary>
                {body}
              </details>
            ) : body}
          </div>
        )
      })}
    </div>
  )
}
