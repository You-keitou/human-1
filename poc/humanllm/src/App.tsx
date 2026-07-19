import { useState, useCallback } from 'react'
import type { WsServerMessage } from '../shared/types'
import { useWebSocket } from './hooks/useWebSocket'
import { RequestQueue } from './components/RequestQueue'
import { HistoryList } from './components/HistoryList'
import { PromptDisplay } from './components/PromptDisplay'
import { ResponseWorkspace } from './components/ResponseWorkspace'
import type { ParsedTurn } from './components/RichResponseInput'
import './App.css'

export type RequestItem = {
  requestId: string
  messages: import('../shared/types').ChatMessage[]
  model: string
  createdAt: number
  tools?: import('../shared/types').ToolInfo[]
}

export type HistoryItem = RequestItem & {
  response: string
  completedAt: number
}

function App() {
  const [requests, setRequests] = useState<RequestItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)

  const handleMessage = useCallback((msg: WsServerMessage) => {
    if (msg.type === 'request') {
      setRequests((prev) => {
        const next = [...prev, msg]
        if (prev.length === 0) {
          setSelectedId(msg.requestId)
        }
        return next
      })
    } else if (msg.type === 'timeout') {
      setRequests((prev) => {
        const next = prev.filter((r) => r.requestId !== msg.requestId)
        setSelectedId((id) => {
          if (id === msg.requestId) {
            return next[0]?.requestId ?? null
          }
          return id
        })
        return next
      })
    }
  }, [])

  const { status, send } = useWebSocket(handleMessage)

  const selectedRequest = requests.find((r) => r.requestId === selectedId) ?? null
  const selectedHistory = history.find((h) => h.requestId === selectedHistoryId) ?? null

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
    setSelectedHistoryId(null)
  }, [])

  const handleSelectHistory = useCallback((id: string) => {
    setSelectedHistoryId(id)
    setSelectedId(null)
  }, [])

  const completeRequest = useCallback((responseLabel: string) => {
    setRequests((prev) => {
      const completed = prev.find((r) => r.requestId === selectedId)
      if (completed) {
        setHistory((h) => [
          { ...completed, response: responseLabel, completedAt: Math.floor(Date.now() / 1000) },
          ...h,
        ])
        setSelectedHistoryId(completed.requestId)
      }
      const next = prev.filter((r) => r.requestId !== selectedId)
      setSelectedId(next[0]?.requestId ?? null)
      return next
    })
  }, [selectedId])

  // エディタで書いた LLM 出力(thinking / tool call / final)を順に送信する
  const handleSendTurn = useCallback((parsed: ParsedTurn) => {
    if (!selectedId) return
    for (const t of parsed.thoughts) {
      send({ type: 'reasoning', requestId: selectedId, content: t + '\n' })
    }
    if (parsed.tool) {
      send({
        type: 'function_call',
        requestId: selectedId,
        callId: crypto.randomUUID(),
        name: parsed.tool.name,
        arguments: JSON.stringify(parsed.tool.args),
      })
      completeRequest(`[function_call: ${parsed.tool.name}]`)
    } else if (parsed.finalText) {
      send({ type: 'response', requestId: selectedId, content: parsed.finalText })
      completeRequest(parsed.finalText)
    }
  }, [selectedId, send, completeRequest])

  // 途中経過: thinking はそのまま、本文は delta として送る(リクエストは開いたまま)
  const handleProgressTurn = useCallback((parsed: ParsedTurn) => {
    if (!selectedId) return
    for (const t of parsed.thoughts) {
      send({ type: 'reasoning', requestId: selectedId, content: t + '\n' })
    }
    if (parsed.finalText) {
      send({ type: 'delta', requestId: selectedId, content: parsed.finalText + '\n' })
    }
  }, [selectedId, send])

  const statusLabel = {
    connecting: { text: 'Reconnecting…', cls: 'status-connecting' },
    open: { text: 'Connected', cls: 'status-open' },
    closed: { text: 'Disconnected', cls: 'status-closed' },
  }[status]

  return (
    <div className="layout">
      <header className="header">
        <h1 className="header-title">humanllm</h1>
        <span className={`header-status ${statusLabel.cls}`}>{statusLabel.text}</span>
      </header>

      <div className="main">
        <aside className="sidebar">
          <RequestQueue
            requests={requests}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
          <HistoryList
            history={history}
            selectedId={selectedHistoryId}
            onSelect={handleSelectHistory}
          />
        </aside>

        <section className="content">
          {selectedRequest ? (
            <div className="workspace-split">
              <div className="request-pane">
                <PromptDisplay messages={selectedRequest.messages} />
              </div>
              <div className="response-pane">
                <ResponseWorkspace
                  key={selectedRequest.requestId}
                  tools={selectedRequest.tools ?? []}
                  requestCreatedAt={selectedRequest.createdAt}
                  disabled={false}
                  onSendTurn={handleSendTurn}
                  onProgress={handleProgressTurn}
                />
              </div>
            </div>
          ) : selectedHistory ? (
            <PromptDisplay
              messages={[
                ...selectedHistory.messages,
                { role: 'assistant', content: selectedHistory.response },
              ]}
            />
          ) : (
            <div className="content-empty">
              <p>Waiting for an API request…</p>
              <code>POST /v1/chat/completions</code>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default App
