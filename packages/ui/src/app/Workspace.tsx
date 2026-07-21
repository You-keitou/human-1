import type { ChatMessage, ParsedTurn, ToolCallItem } from '@human-1/shared'
import { type ReactElement, useMemo, useRef, useState } from 'react'
import { RichEditor, type RichEditorHandle } from '../editor/RichEditor'
import type { AppStore, PendingRequest } from '../lib/store'
import { useAppStore } from '../lib/store'
import { sendTurn } from '../lib/turn'
import { useIsMobile } from '../lib/useMedia'
import { Frame, Spacer, Text } from '../ui/primitives'
import { FlowWhiteboard } from '../whiteboard/FlowWhiteboard'
import { LiveHeader } from './LiveHeader'

type Tab = 'raw' | 'whiteboard'

export function Workspace({ token, tab = 'raw' }: { token: string; tab?: Tab }): ReactElement {
  const store = useAppStore(token)
  const isMobile = useIsMobile()
  const [activeTab, setActiveTab] = useState<Tab>(tab)
  const [warnings, setWarnings] = useState<string[]>([])
  // 誤送信ガードでブロックされた turn。banner から「本文として送信」で強行する。
  const [blocked, setBlocked] = useState<ParsedTurn | null>(null)
  const editorRef = useRef<RichEditorHandle | null>(null)

  const avg = useMemo(() => {
    const vals = Object.values(store.state.scores).map((s) => s.value)
    if (!vals.length) return '0.0'
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
  }, [store.state.scores])

  const selected = store.selected

  const finish = (): void => {
    editorRef.current?.clear()
    // 送信後もフォーカスを維持し、続けて書けるようにする。
    editorRef.current?.focus()
  }

  const onSend = (parsed: ParsedTurn): void => {
    if (!selected) return
    // 直前がブロック状態なら 2 回目の送信で強行する。
    const outcome = sendTurn(store, selected.requestId, parsed, { force: blocked !== null })
    setWarnings(outcome.warnings)
    if (outcome.kind === 'blocked') {
      setBlocked(parsed)
      return
    }
    setBlocked(null)
    if (outcome.sent && outcome.kind !== 'none') finish()
  }

  const forceSend = (): void => {
    if (!selected || !blocked) return
    const outcome = sendTurn(store, selected.requestId, blocked, { force: true })
    setWarnings(outcome.warnings)
    setBlocked(null)
    if (outcome.sent && outcome.kind !== 'none') finish()
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
        <ConversationPanel store={store} isMobile={isMobile} />
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
              blocked={blocked !== null}
              onForceSend={forceSend}
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

// 左パネル: 会話履歴を主役にした 1 枚のカード。上部に pending 切替チップ、本体に
// 出題(user_message)を大きく + 自分の thinking / tool / 回答を時系列で。
function ConversationPanel({
  store,
  isMobile,
}: {
  store: AppStore
  isMobile: boolean
}): ReactElement {
  const { requests } = store.state
  const selected = store.selected
  return (
    <Frame
      dir="col"
      w={isMobile ? 'fill' : 440}
      h={isMobile ? 'fit' : 'fill'}
      fill="var(--surface)"
      border={[1, 'var(--border)']}
      radius={8}
      clip
      align="start"
      style={{ flexShrink: 0, minHeight: 0 }}
    >
      <PendingSwitcher
        requests={requests}
        selectedId={selected?.requestId ?? null}
        onSelect={store.select}
      />
      {selected ? (
        <Conversation req={selected} isMobile={isMobile} />
      ) : (
        <EmptyConversation status={store.status} />
      )}
    </Frame>
  )
}

// 上部の pending 切替。複数 pending の切替をコンパクトに維持する。単一でもチップを描画する
// (現在アクティブな request の可視化 + aria-pressed セマンティクス)。
function PendingSwitcher({
  requests,
  selectedId,
  onSelect,
}: {
  requests: PendingRequest[]
  selectedId: string | null
  onSelect: (id: string) => void
}): ReactElement {
  return (
    <Frame
      dir="row"
      w="fill"
      gap={8}
      pad={[10, 16]}
      align="center"
      borderSides={{ bottom: 1 }}
      borderColor="var(--border)"
      style={{ flexShrink: 0, flexWrap: 'wrap' }}
    >
      <Text size={10} family="mono" color="var(--text-muted)" ls={1.2} nowrap>
        会話 · pending {requests.length}
      </Text>
      <Spacer />
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
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 999,
              padding: '3px 10px',
              cursor: 'pointer',
            }}
          >
            #{i + 1} · {r.endpoint}
          </button>
        )
      })}
    </Frame>
  )
}

function EmptyConversation({ status }: { status: AppStore['status'] }): ReactElement {
  return (
    <Frame
      dir="col"
      grow
      w="fill"
      gap={10}
      pad={28}
      align="center"
      justify="center"
      style={{ minHeight: 200 }}
    >
      <Text size={14} family="mono" color="var(--text-muted)">
        {status === 'open' ? 'API リクエストを待っています' : 'サーバーへ接続中…'}
      </Text>
      <Text size={11} family="mono" color="var(--text-muted)">
        POST /v1/responses · /v1/messages
      </Text>
    </Frame>
  )
}

type MsgKind = 'system' | 'trainer' | 'you' | 'toolresult'

function classifyMessage(m: ChatMessage): MsgKind {
  if (/\[(function_call_output|tool_result)\]/.test(m.content)) return 'toolresult'
  if (m.role === 'system') return 'system'
  if (m.role === 'assistant') return 'you'
  return 'trainer'
}

// 会話タイムライン本体。出題(trainer=user)を大きく、system は畳んで小さく、
// 自分(you)/ tool 結果は中サイズ。最後の出題を「現在の出題」として最も目立たせる。
function Conversation({ req, isMobile }: { req: PendingRequest; isMobile: boolean }): ReactElement {
  const lastUserIdx = (() => {
    for (let i = req.messages.length - 1; i >= 0; i--) {
      if (classifyMessage(req.messages[i] as ChatMessage) === 'trainer') return i
    }
    return -1
  })()

  return (
    <Frame
      dir="col"
      grow
      w="fill"
      gap={12}
      pad={16}
      align="start"
      style={{
        minHeight: 0,
        overflowY: 'auto',
        maxHeight: isMobile ? '46vh' : undefined,
      }}
    >
      {req.tools.length > 0 && <ToolsRow req={req} />}
      {req.messages.map((m, i) => (
        <MessageCard
          key={`${m.role}-${i}`}
          message={m}
          kind={classifyMessage(m)}
          primary={i === lastUserIdx}
        />
      ))}
      {(req.thoughts.length > 0 || req.toolCalls.length > 0) && (
        <YouEcho thoughts={req.thoughts} toolCalls={req.toolCalls} />
      )}
    </Frame>
  )
}

function ToolsRow({ req }: { req: PendingRequest }): ReactElement {
  return (
    <Frame dir="col" w="fill" gap={7} pad={[8, 12]} radius={6} fill="var(--surface2)" align="start">
      <Text size={10} family="mono" weight={600} color="var(--text-muted)" ls={1.2}>
        TOOLS · {req.tools.length}
      </Text>
      <Frame dir="row" w="fill" gap={6} align="start" style={{ flexWrap: 'wrap' }}>
        {req.tools.map((t) => (
          <Frame
            key={t.name}
            dir="row"
            pad={[2, 8]}
            radius={999}
            fill="var(--tool-soft)"
            border={[1, 'var(--border)']}
          >
            <Text size={10} family="mono" color="var(--tool)">
              {t.name}
            </Text>
          </Frame>
        ))}
      </Frame>
    </Frame>
  )
}

function MessageCard({
  message,
  kind,
  primary,
}: {
  message: ChatMessage
  kind: MsgKind
  primary: boolean
}): ReactElement {
  if (kind === 'system') return <SystemCard content={message.content} />
  if (kind === 'toolresult') return <ToolResultCard content={message.content} />
  if (kind === 'you') return <YouMessageCard content={message.content} />
  return <TrainerCard content={message.content} primary={primary} />
}

function SystemCard({ content }: { content: string }): ReactElement {
  const preview = content.replace(/\s+/g, ' ').trim().slice(0, 80)
  return (
    <Frame dir="col" w="fill" gap={4} pad={[8, 12]} radius={6} fill="var(--surface2)" align="start">
      <Frame dir="row" w="fill" align="center">
        <Text size={9} family="mono" weight={600} color="var(--text-muted)" ls={1.2}>
          SYSTEM
        </Text>
        <Spacer />
        <Text size={9} family="mono" color="var(--text-muted)">
          {content.length} chars
        </Text>
      </Frame>
      <Text
        size={11}
        family="mono"
        color="var(--text-muted)"
        w="fill"
        style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        ▸ {preview}
      </Text>
    </Frame>
  )
}

// 出題 = 主役。大きく・読みやすく・折返し良く。primary(最新の出題)はさらに強調。
function TrainerCard({ content, primary }: { content: string; primary: boolean }): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={9}
      pad={primary ? [14, 16] : [12, 16]}
      radius={8}
      fill="var(--accent-soft)"
      borderSides={{ left: primary ? 3 : 2 }}
      borderColor="var(--accent)"
      align="start"
    >
      <Frame dir="row" w="fill" align="center" gap={8}>
        <Text size={10} family="mono" weight={600} color="var(--accent-strong)" ls={1.2}>
          TRAINER
        </Text>
        {primary && (
          <Frame dir="row" pad={[1, 8]} radius={999} fill="var(--surface)">
            <Text size={9} family="mono" weight={600} color="var(--accent-strong)" ls={0.6}>
              出題
            </Text>
          </Frame>
        )}
      </Frame>
      <Text
        size={primary ? 16 : 14}
        family="ui"
        lh={1.65}
        color="var(--text-primary)"
        w="fill"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {content}
      </Text>
    </Frame>
  )
}

function YouMessageCard({ content }: { content: string }): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={5}
      pad={[10, 14]}
      radius={6}
      fill="var(--surface2)"
      borderSides={{ left: 2 }}
      borderColor="var(--border-strong)"
      align="start"
    >
      <Text size={10} family="mono" weight={600} color="var(--text-muted)" ls={1.2}>
        YOU
      </Text>
      <Text
        size={12.5}
        family="ui"
        lh={1.6}
        color="var(--text-secondary)"
        w="fill"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {content}
      </Text>
    </Frame>
  )
}

function ToolResultCard({ content }: { content: string }): ReactElement {
  return (
    <Frame
      dir="col"
      w="fill"
      gap={5}
      pad={[9, 14]}
      radius={6}
      fill="var(--tool-soft)"
      borderSides={{ left: 2 }}
      borderColor="var(--tool)"
      align="start"
    >
      <Text size={10} family="mono" weight={600} color="var(--tool)" ls={1.2}>
        [tool_result]
      </Text>
      <Text
        size={11}
        family="mono"
        lh={1.55}
        color="var(--text-secondary)"
        w="fill"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {content.length > 1200 ? `${content.slice(0, 1200)}…` : content}
      </Text>
    </Frame>
  )
}

// 自分がこのターンで既に送った reasoning / tool call のエコー。
function YouEcho({
  thoughts,
  toolCalls,
}: {
  thoughts: string[]
  toolCalls: ToolCallItem[]
}): ReactElement {
  return (
    <Frame dir="col" w="fill" gap={8} align="start">
      {thoughts.length > 0 && (
        <Frame
          dir="col"
          w="fill"
          gap={4}
          pad={[10, 14]}
          radius={6}
          fill="var(--thinking-soft)"
          borderSides={{ left: 2 }}
          borderColor="var(--thinking)"
          align="start"
        >
          <Text size={10} family="mono" weight={600} color="var(--thinking)" ls={1.2}>
            thinking · 送信済み
          </Text>
          {thoughts.map((t, i) => (
            <Text key={i} size={12.5} italic lh={1.6} color="var(--text-secondary)" w="fill">
              {t}
            </Text>
          ))}
        </Frame>
      )}
      {toolCalls.length > 0 && (
        <Frame
          dir="col"
          w="fill"
          gap={4}
          pad={[10, 14]}
          radius={6}
          fill="var(--tool-soft)"
          borderSides={{ left: 2 }}
          borderColor="var(--tool)"
          align="start"
        >
          <Text size={10} family="mono" weight={600} color="var(--tool)" ls={1.2}>
            function_calls · 送信済み
          </Text>
          {toolCalls.map((tc, i) => (
            <Text key={i} size={11} family="mono" color="var(--text-secondary)" w="fill">
              {tc.type === 'function_call' ? tc.name : 'shell'}
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
  blocked,
  onForceSend,
  onReady,
  onSend,
  onSendClick,
}: {
  selected: PendingRequest | null
  warnings: string[]
  blocked: boolean
  onForceSend: () => void
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
      {blocked && (
        <div className="misfire-banner" role="alert">
          <span className="misfire-title">送信を止めました</span>
          <span className="misfire-body">
            「/」で始まる 1 行だけの送信です。スラッシュコマンドの打ち損ねの可能性があります。
          </span>
          <button type="button" className="misfire-force" onClick={onForceSend}>
            本文として送信
          </button>
        </div>
      )}
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
