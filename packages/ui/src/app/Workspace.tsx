import type { ParsedTurn } from '@human-1/shared'
import { type ReactElement, useMemo, useRef, useState } from 'react'
import { RichEditor, type RichEditorHandle } from '../editor/RichEditor'
import type { AppStore, HistoryEntry, PendingRequest } from '../lib/store'
import { useAppStore } from '../lib/store'
import { sendTurn } from '../lib/turn'
import { useIsMobile } from '../lib/useMedia'
import { Box, Frame, Spacer, Text } from '../ui/primitives'
import { FlowWhiteboard } from '../whiteboard/FlowWhiteboard'
import { LiveHeader } from './LiveHeader'

type Tab = 'raw' | 'whiteboard'

export function Workspace({ token, tab = 'raw' }: { token: string; tab?: Tab }): ReactElement {
  const store = useAppStore(token)
  const isMobile = useIsMobile()
  const [activeTab, setActiveTab] = useState<Tab>(tab)
  const [warnings, setWarnings] = useState<string[]>([])
  const editorRef = useRef<RichEditorHandle | null>(null)

  const avg = useMemo(() => {
    const vals = Object.values(store.state.scores).map((s) => s.value)
    if (!vals.length) return '0.0'
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
  }, [store.state.scores])

  const selected = store.selected

  const onSend = (parsed: ParsedTurn): void => {
    if (!selected) return
    const outcome = sendTurn(store, selected.requestId, parsed)
    setWarnings(outcome.warnings)
    if (outcome.sent && outcome.kind !== 'none') editorRef.current?.clear()
  }

  const insertMermaid = (mermaid: string): void => {
    editorRef.current?.insert(mermaid)
    setActiveTab('raw')
  }

  return (
    <Frame dir="col" w="fill" style={{ minHeight: '100vh' }}>
      <LiveHeader
        active="workspace"
        status={store.status}
        epoch={store.state.history.length}
        avg={avg}
      />
      <Frame
        dir={isMobile ? 'col' : 'row'}
        grow
        w="fill"
        gap={isMobile ? 12 : 20}
        pad={isMobile ? 12 : 20}
        align="start"
        style={{ minHeight: 0 }}
      >
        <LeftColumn store={store} isMobile={isMobile} />
        <Frame
          dir="col"
          grow
          h={isMobile ? 'fit' : 'fill'}
          w="fill"
          fill="var(--surface)"
          border={[1, 'var(--border)']}
          radius={8}
          clip
          style={{ minHeight: isMobile ? 380 : 0 }}
        >
          <EditorTabs activeTab={activeTab} onTab={setActiveTab} />
          {/* エディタは常時マウント(タブ切替で unmount すると下書き・Mermaid 挿入先が失われる)。
              非表示側は display:none で隠す。 */}
          <div
            style={{
              display: activeTab === 'raw' ? 'flex' : 'none',
              flex: 1,
              flexDirection: 'column',
              minHeight: 0,
              width: '100%',
            }}
          >
            <RawPanel
              selected={selected}
              warnings={warnings}
              onReady={(h) => {
                editorRef.current = h
              }}
              onSend={onSend}
              onSendClick={() => editorRef.current?.send()}
            />
          </div>
          {activeTab === 'whiteboard' && (
            <div style={{ flex: 1, minHeight: 320 }}>
              <FlowWhiteboard onInsertMermaid={insertMermaid} />
            </div>
          )}
        </Frame>
      </Frame>
    </Frame>
  )
}

function LeftColumn({ store, isMobile }: { store: AppStore; isMobile: boolean }): ReactElement {
  const { requests } = store.state
  const selected = store.selected
  return (
    <Frame
      dir="col"
      w={isMobile ? 'fill' : 440}
      h={isMobile ? 'fit' : 'fill'}
      gap={12}
      align="start"
      style={{ flexShrink: 0 }}
    >
      <RequestQueue
        requests={requests}
        selectedId={selected?.requestId ?? null}
        onSelect={store.select}
      />
      {selected ? <RequestView req={selected} /> : <EmptyRequest />}
      <History history={store.state.history} scores={store.state.scores} />
    </Frame>
  )
}

function RequestQueue({
  requests,
  selectedId,
  onSelect,
}: {
  requests: PendingRequest[]
  selectedId: string | null
  onSelect: (id: string) => void
}): ReactElement {
  return (
    <Frame dir="col" w="fill" gap={6} align="start">
      <Text size={11} family="mono" color="var(--text-muted)" ls={1.2}>
        REQUESTS · {requests.length}
      </Text>
      {requests.length === 0 && (
        <Text size={12} family="mono" color="var(--text-muted)">
          リクエスト待機中…
        </Text>
      )}
      <Frame dir="row" w="fill" gap={6} align="start" style={{ flexWrap: 'wrap' }}>
        {requests.map((r, i) => {
          const active = r.requestId === selectedId
          return (
            <button
              key={r.requestId}
              type="button"
              onClick={() => onSelect(r.requestId)}
              aria-pressed={active}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 600,
                color: active ? 'var(--on-accent)' : 'var(--text-secondary)',
                background: active ? 'var(--accent)' : 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
            >
              #{i + 1} · {r.endpoint}
            </button>
          )
        })}
      </Frame>
    </Frame>
  )
}

function EmptyRequest(): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={8}
      pad={24}
      align="center"
      justify="center"
      fill="var(--surface)"
      border={[1, 'var(--border)']}
      radius={8}
      style={{ minHeight: 160 }}
    >
      <Text size={13} family="mono" color="var(--text-muted)">
        API リクエストを待っています
      </Text>
      <Text size={11} family="mono" color="var(--text-muted)">
        POST /v1/responses · /v1/messages
      </Text>
    </Frame>
  )
}

function RequestView({ req }: { req: PendingRequest }): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={10}
      pad={16}
      align="start"
      fill="var(--surface)"
      border={[1, 'var(--border)']}
      radius={8}
      clip
    >
      <Frame dir="row" w="fill" align="center">
        <Text size={11} family="mono" color="var(--text-muted)" ls={1.2}>
          REQUEST · {req.endpoint}
        </Text>
        <Spacer />
        <Text size={10} family="mono" color="var(--text-muted)">
          {req.messages.length} msgs
        </Text>
      </Frame>
      {req.tools.length > 0 && (
        <Frame dir="row" w="fill" gap={6} align="start" style={{ flexWrap: 'wrap' }}>
          {req.tools.map((t) => (
            <Frame key={t.name} dir="row" pad={[2, 8]} radius={999} fill="var(--tool-soft)">
              <Text size={10} family="mono" color="var(--tool)">
                {t.name}
              </Text>
            </Frame>
          ))}
        </Frame>
      )}
      <Frame dir="col" w="fill" gap={8} align="start" style={{ maxHeight: 260, overflow: 'auto' }}>
        {req.messages.map((m, i) => (
          <Frame
            key={`${m.role}-${i}`}
            dir="col"
            w="fill"
            gap={4}
            pad={[8, 12]}
            radius={6}
            fill={m.role === 'system' ? 'var(--surface2)' : 'var(--accent-soft)'}
            borderSides={{ left: 2 }}
            borderColor={m.role === 'system' ? 'var(--border-strong)' : 'var(--accent)'}
            align="start"
          >
            <Text size={9} family="mono" weight={600} color="var(--text-muted)" ls={1.2}>
              {m.role.toUpperCase()}
            </Text>
            <Text
              size={12}
              family="mono"
              lh={1.5}
              color="var(--text-secondary)"
              w="fill"
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {m.content.length > 800 ? `${m.content.slice(0, 800)}…` : m.content}
            </Text>
          </Frame>
        ))}
      </Frame>
      {req.thoughts.length > 0 && (
        <Frame
          dir="col"
          w="fill"
          gap={4}
          pad={[8, 12]}
          radius={6}
          fill="var(--thinking-soft)"
          borderSides={{ left: 2 }}
          borderColor="var(--thinking)"
          align="start"
        >
          <Text size={9} family="mono" weight={600} color="var(--thinking)" ls={1.2}>
            SENT THINKING
          </Text>
          {req.thoughts.map((t, i) => (
            <Text key={i} size={12} italic color="var(--text-secondary)" w="fill">
              {t}
            </Text>
          ))}
        </Frame>
      )}
    </Frame>
  )
}

function EditorTabs({
  activeTab,
  onTab,
}: {
  activeTab: Tab
  onTab: (t: Tab) => void
}): ReactElement {
  return (
    <Frame
      dir="row"
      w="fill"
      gap={18}
      pad={[9, 18]}
      align="center"
      borderSides={{ bottom: 1 }}
      borderColor="var(--border)"
      style={{ flexShrink: 0 }}
    >
      {(['raw', 'whiteboard'] as Tab[]).map((t) => {
        const active = t === activeTab
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              padding: '6px 2px',
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {t === 'raw' ? 'Raw output' : 'Whiteboard'}
          </button>
        )
      })}
    </Frame>
  )
}

function RawPanel({
  selected,
  warnings,
  onReady,
  onSend,
  onSendClick,
}: {
  selected: PendingRequest | null
  warnings: string[]
  onReady: (h: RichEditorHandle) => void
  onSend: (parsed: ParsedTurn) => void
  onSendClick: () => void
}): ReactElement {
  return (
    <Frame dir="col" grow w="fill" gap={12} pad={[14, 18]} align="start" style={{ minHeight: 0 }}>
      <RichEditor
        key={selected?.requestId ?? 'none'}
        tools={selected?.tools ?? []}
        disabled={!selected}
        onReady={onReady}
        onSend={onSend}
      />
      {warnings.length > 0 && (
        <div className="parse-warnings">
          {warnings.map((w, i) => (
            <div key={i} className="parse-warning">
              {w}
            </div>
          ))}
        </div>
      )}
      <Frame dir="row" w="fill" gap={12} align="center">
        <Text size={11} family="mono" color="var(--text-muted)">
          ⌘↵ で送信 · thinking → tools / final の順で配信
        </Text>
        <Spacer />
        <button
          type="button"
          disabled={!selected}
          onClick={onSendClick}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 13,
            fontWeight: 700,
            color: selected ? 'var(--on-accent)' : 'var(--text-muted)',
            background: selected ? 'var(--accent)' : 'var(--surface3)',
            border: 'none',
            borderRadius: 6,
            padding: '9px 20px',
            cursor: selected ? 'pointer' : 'default',
          }}
        >
          送信
        </button>
      </Frame>
    </Frame>
  )
}

function History({
  history,
  scores,
}: {
  history: HistoryEntry[]
  scores: Record<string, { value: number; max: number }>
}): ReactElement | null {
  if (history.length === 0) return null
  const scoreList = Object.values(scores)
  return (
    <Frame dir="col" w="fill" gap={6} align="start">
      <Text size={11} family="mono" color="var(--text-muted)" ls={1.2}>
        HISTORY · {history.length}
        {scoreList.length > 0 && ` · scores ${scoreList.length}`}
      </Text>
      <Frame dir="col" w="fill" gap={4} align="start" style={{ maxHeight: 200, overflow: 'auto' }}>
        {history.map((h) => (
          <Frame
            key={`${h.requestId}-${h.completedAt}`}
            dir="row"
            w="fill"
            gap={8}
            pad={[6, 10]}
            radius={6}
            fill="var(--surface2)"
            align="center"
          >
            <Box
              w={7}
              h={7}
              radius={999}
              fill={
                h.kind === 'answered'
                  ? 'var(--tool)'
                  : h.kind === 'tools'
                    ? 'var(--accent)'
                    : 'var(--warn)'
              }
            />
            <Text size={11} family="mono" weight={600} color="var(--text-secondary)">
              {h.kind}
            </Text>
            <Text
              size={11}
              family="mono"
              color="var(--text-muted)"
              grow
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {h.kind === 'tools'
                ? (h.items ?? [])
                    .map((it) => (it.type === 'function_call' ? it.name : 'shell'))
                    .join(', ')
                : (h.content ?? '').slice(0, 60) || '—'}
            </Text>
          </Frame>
        ))}
      </Frame>
    </Frame>
  )
}
