import type {
  ApiEndpoint,
  ChatMessage,
  Score,
  ToolCallItem,
  ToolInfo,
  WsRequestMessage,
  WsResponseMessage,
  WsServerMessage,
} from '@human-1/shared'
import { useCallback, useMemo, useReducer } from 'react'
import { useWebSocket, type WsStatus } from './useWebSocket'

// 人間 LLM UI のアプリ状態。WS の request / thought / tool_called / answered / timeout / score を
// 受けて更新する。requestId で重複排除(pending snapshot 再送・replay 対応)。

export type PendingRequest = {
  requestId: string
  endpoint: ApiEndpoint
  messages: ChatMessage[]
  model: string
  createdAt: number
  tools: ToolInfo[]
  // 観測(自分が送った reasoning / tool call のエコー)。
  thoughts: string[]
  toolCalls: ToolCallItem[]
}

export type HistoryEntry = {
  requestId: string
  endpoint: ApiEndpoint
  createdAt: number
  completedAt: number
  kind: 'answered' | 'tools' | 'timeout'
  thoughts: string[]
  content?: string
  items?: ToolCallItem[]
}

export type AppState = {
  requests: PendingRequest[]
  history: HistoryEntry[]
  scores: Record<string, Score>
  selectedId: string | null
}

const initialState: AppState = {
  requests: [],
  history: [],
  scores: {},
  selectedId: null,
}

type Action = { type: 'ws'; msg: WsServerMessage } | { type: 'select'; id: string | null }

function reducer(state: AppState, action: Action): AppState {
  if (action.type === 'select') return { ...state, selectedId: action.id }
  const msg = action.msg
  switch (msg.type) {
    case 'request': {
      // requestId 重複排除(pending snapshot 再送 / replay の二重挿入を防ぐ)。
      if (state.requests.some((r) => r.requestId === msg.requestId)) return state
      // 既に履歴で終端済み(切断窓中に answered → 再接続で request が来る等)なら再表示しない。
      if (state.history.some((h) => h.requestId === msg.requestId)) return state
      const req = toPending(msg)
      return {
        ...state,
        requests: [...state.requests, req],
        selectedId: state.selectedId ?? msg.requestId,
      }
    }
    case 'thought':
      return updateRequest(state, msg.requestId, (r) => ({
        ...r,
        thoughts: [...r.thoughts, msg.content],
      }))
    case 'tool_called': {
      // tool_called はそのターンの終端(tool 提出でリクエスト解決)。履歴へ移し pending から外す。
      const req = state.requests.find((r) => r.requestId === msg.requestId)
      const thoughts = req?.thoughts ?? []
      return terminate(state, msg.requestId, {
        requestId: msg.requestId,
        endpoint: req?.endpoint ?? 'responses',
        createdAt: req?.createdAt ?? Date.now(),
        completedAt: Date.now(),
        kind: 'tools',
        thoughts,
        items: msg.items,
      })
    }
    case 'answered': {
      const req = state.requests.find((r) => r.requestId === msg.requestId)
      if (state.history.some((h) => h.requestId === msg.requestId)) return state
      return terminate(state, msg.requestId, {
        requestId: msg.requestId,
        endpoint: req?.endpoint ?? 'responses',
        createdAt: req?.createdAt ?? Date.now(),
        completedAt: Date.now(),
        kind: 'answered',
        thoughts: req?.thoughts ?? [],
        content: msg.content,
      })
    }
    case 'timeout': {
      const req = state.requests.find((r) => r.requestId === msg.requestId)
      if (state.history.some((h) => h.requestId === msg.requestId)) return state
      return terminate(state, msg.requestId, {
        requestId: msg.requestId,
        endpoint: req?.endpoint ?? 'responses',
        createdAt: req?.createdAt ?? Date.now(),
        completedAt: Date.now(),
        kind: 'timeout',
        thoughts: req?.thoughts ?? [],
      })
    }
    case 'score':
      return { ...state, scores: { ...state.scores, [msg.rolloutId]: msg.score } }
    default:
      return state
  }
}

function toPending(msg: WsRequestMessage): PendingRequest {
  return {
    requestId: msg.requestId,
    endpoint: msg.endpoint,
    messages: msg.messages,
    model: msg.model,
    createdAt: msg.createdAt,
    tools: msg.tools ?? [],
    thoughts: [],
    toolCalls: [],
  }
}

function updateRequest(
  state: AppState,
  requestId: string,
  fn: (r: PendingRequest) => PendingRequest,
): AppState {
  const idx = state.requests.findIndex((r) => r.requestId === requestId)
  if (idx === -1) return state
  const next = state.requests.slice()
  next[idx] = fn(next[idx] as PendingRequest)
  return { ...state, requests: next }
}

// pending から外し、履歴へ(新しい順で先頭)。選択はターン消滅時に次の pending へ。
function terminate(state: AppState, requestId: string, entry: HistoryEntry): AppState {
  const requests = state.requests.filter((r) => r.requestId !== requestId)
  const selectedId =
    state.selectedId === requestId ? (requests[0]?.requestId ?? null) : state.selectedId
  return { ...state, requests, history: [entry, ...state.history], selectedId }
}

export type AppStore = {
  status: WsStatus
  state: AppState
  selected: PendingRequest | null
  select: (id: string | null) => void
  sendReasoning: (requestId: string, content: string) => void
  sendResponse: (requestId: string, content: string) => void
  sendToolCalls: (requestId: string, items: ToolCallItem[]) => void
}

export function useAppStore(token: string | null): AppStore {
  const [state, dispatch] = useReducer(reducer, initialState)
  const onMessage = useCallback((msg: WsServerMessage) => dispatch({ type: 'ws', msg }), [])
  const { status, send } = useWebSocket(token, onMessage)

  const select = useCallback((id: string | null) => dispatch({ type: 'select', id }), [])

  const wrap = useCallback((msg: WsResponseMessage) => send(msg), [send])
  const sendReasoning = useCallback(
    (requestId: string, content: string) => wrap({ type: 'reasoning', requestId, content }),
    [wrap],
  )
  const sendResponse = useCallback(
    (requestId: string, content: string) => wrap({ type: 'response', requestId, content }),
    [wrap],
  )
  const sendToolCalls = useCallback(
    (requestId: string, items: ToolCallItem[]) => wrap({ type: 'tool_calls', requestId, items }),
    [wrap],
  )

  const selected = useMemo(
    () => state.requests.find((r) => r.requestId === state.selectedId) ?? null,
    [state.requests, state.selectedId],
  )

  return { status, state, selected, select, sendReasoning, sendResponse, sendToolCalls }
}
