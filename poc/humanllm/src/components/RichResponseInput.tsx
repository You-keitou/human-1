import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Extension, Node, textblockTypeInputRule, type Editor, type Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import type { ToolInfo } from '../../shared/types'

// ---------- 送信内容のパース結果 ----------
export type ParsedTurn = {
  thoughts: string[]
  tool: { name: string; args: Record<string, unknown> } | null
  finalText: string
  warnings: string[]
}

type Props = {
  tools: ToolInfo[]
  requestCreatedAt: number
  disabled: boolean
  onSendTurn: (parsed: ParsedTurn) => void
  onProgress: (parsed: ParsedTurn) => void
  onEditorReady?: (insert: (text: string) => void) => void
}

// ---------- Claude 方言の raw タグブロック ----------
// <thinking> ブロック: タグの見た目は CSS の ::before/::after で描画する
const ThinkingBlock = Node.create({
  name: 'thinkingBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  parseHTML() {
    return [{ tag: 'pre[data-thinking]' }]
  },
  renderHTML() {
    return ['pre', { 'data-thinking': '', class: 'rt-thinking' }, ['code', 0]]
  },
  addInputRules() {
    // 生で <thinking> と打ってスペース/改行するとブロック化する
    return [textblockTypeInputRule({ find: /^<thinking>[\s\n]$/, type: this.type })]
  },
})

// <function_calls><invoke name="X"> ブロック: 中身は <parameter> タグ(または JSON)
const ToolCallBlock = Node.create({
  name: 'toolCallBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  addAttributes() {
    return { toolName: { default: 'Bash' } }
  },
  parseHTML() {
    return [{
      tag: 'pre[data-tool-call]',
      getAttrs: (el) => ({ toolName: (el as HTMLElement).getAttribute('data-tool-call') ?? 'Bash' }),
    }]
  },
  renderHTML({ node }) {
    return ['pre', { 'data-tool-call': node.attrs.toolName, class: 'rt-toolcall' }, ['code', 0]]
  },
})

// ---------- "/" スラッシュメニュー ----------
type SlashItem = {
  title: string
  hint: string
  run: (editor: Editor, range: Range) => void
}

const SlashMenu = Extension.create<{ getItems: (query: string) => SlashItem[] }>({
  name: 'slashMenu',
  addOptions() {
    return { getItems: () => [] }
  },
  addProseMirrorPlugins() {
    const ext = this
    let el: HTMLDivElement | null = null
    let items: SlashItem[] = []
    let selected = 0
    let command: ((item: SlashItem) => void) | null = null

    const destroy = () => { el?.remove(); el = null }
    const renderList = (clientRect?: (() => DOMRect | null) | null) => {
      if (!el) return
      el.innerHTML = ''
      items.forEach((item, i) => {
        const row = document.createElement('div')
        row.className = `slash-item${i === selected ? ' selected' : ''}`
        row.innerHTML = `<span class="slash-title">${item.title}</span><span class="slash-hint">${item.hint}</span>`
        row.addEventListener('mousedown', (e) => { e.preventDefault(); command?.(item) })
        el!.appendChild(row)
      })
      const rect = clientRect?.()
      if (rect) {
        el.style.left = `${rect.left}px`
        el.style.top = `${rect.bottom + 4}px`
      }
    }

    return [
      Suggestion({
        pluginKey: new PluginKey('slashMenu'),
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        command: ({ editor, range, props }) => (props as SlashItem).run(editor as Editor, range),
        items: ({ query }) => ext.options.getItems(query),
        render: () => ({
          onStart: (props) => {
            el = document.createElement('div')
            el.className = 'slash-menu'
            document.body.appendChild(el)
            items = props.items as SlashItem[]
            selected = 0
            command = (item) => props.command(item)
            renderList(props.clientRect)
          },
          onUpdate: (props) => {
            items = props.items as SlashItem[]
            selected = Math.min(selected, Math.max(0, items.length - 1))
            command = (item) => props.command(item)
            renderList(props.clientRect)
          },
          onKeyDown: ({ event }) => {
            if (!el || items.length === 0) return false
            if (event.key === 'ArrowDown') { selected = (selected + 1) % items.length; renderList(); return true }
            if (event.key === 'ArrowUp') { selected = (selected - 1 + items.length) % items.length; renderList(); return true }
            if (event.key === 'Enter') { command?.(items[selected]); return true }
            if (event.key === 'Escape') { destroy(); return true }
            return false
          },
          onExit: destroy,
        }),
      }),
    ]
  },
})

// ---------- 寛容パーサ: raw テキスト → thoughts / tool / finalText ----------
export function parseRawOutput(raw: string): ParsedTurn {
  const thoughts: string[] = []
  const warnings: string[] = []
  let tool: ParsedTurn['tool'] = null

  let rest = raw.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (_m, t: string) => {
    if (t.trim()) thoughts.push(t.trim())
    return ''
  })

  rest = rest.replace(
    /(?:<function_calls>\s*)?<invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/invoke>\s*(?:<\/function_calls>)?/gi,
    (_m, name: string, body: string) => {
      if (tool) {
        warnings.push('invoke は1ターンに1つまで — 最初のものだけ送信します')
        return ''
      }
      const args: Record<string, unknown> = {}
      const re = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/gi
      let m: RegExpExecArray | null
      let found = false
      while ((m = re.exec(body))) { args[m[1]] = m[2].trim(); found = true }
      if (!found) {
        const t = body.trim()
        if (t.startsWith('{')) {
          try { Object.assign(args, JSON.parse(t)); found = true } catch { /* fallthrough */ }
        }
      }
      if (!found && body.trim()) {
        warnings.push(`invoke "${name}" の <parameter> をパースできず、引数なしで送信します`)
      }
      tool = { name, args }
      return ''
    },
  )

  // 事故検出: 崩れたタグの残骸(パースをすり抜けて本文として送信される = 例の事故の再演)
  if (/<\/?invoke|<\/?function_calls|<\/?parameter/i.test(rest)) {
    warnings.push('⚠ 崩れた <invoke> タグを検出 — パースされず本文として漏れます(あの事故の再演です)')
  }
  if (/<\/?think/i.test(rest)) {
    warnings.push('⚠ 崩れた <thinking> タグを検出 — 本文として漏れます')
  }

  return { thoughts, tool, finalText: rest.trim(), warnings }
}

// ツールスキーマから <parameter> の雛形を作る
function parameterSkeleton(tool: ToolInfo): string {
  const schema = tool.parameters as { properties?: Record<string, unknown>; required?: string[] } | undefined
  const keys = schema?.required?.length ? schema.required : Object.keys(schema?.properties ?? {}).slice(0, 2)
  if (!keys.length) return '<parameter name=""></parameter>'
  return keys.map((k) => `<parameter name="${k}"></parameter>`).join('\n')
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ---------- 本体 ----------
export function RichResponseInput({ tools, requestCreatedAt, disabled, onSendTurn, onProgress, onEditorReady }: Props) {
  const toolsRef = useRef(tools)
  toolsRef.current = tools
  const [warnings, setWarnings] = useState<string[]>([])

  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor(Date.now() / 1000) - requestCreatedAt))
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.max(0, Math.floor(Date.now() / 1000) - requestCreatedAt))
    }, 1000)
    return () => clearInterval(timer)
  }, [requestCreatedAt])

  const getItems = useMemo(() => (query: string): SlashItem[] => {
    const base: SlashItem[] = [{
      title: 'thinking',
      hint: '<thinking> 思考ブロック',
      run: (editor, range) => {
        editor.chain().focus().deleteRange(range).insertContent({ type: 'thinkingBlock' }).run()
      },
    }]
    const toolItems: SlashItem[] = toolsRef.current.map((t) => ({
      title: t.name,
      hint: (t.description ?? 'tool call').slice(0, 48),
      run: (editor, range) => {
        editor.chain().focus().deleteRange(range).insertContent({
          type: 'toolCallBlock',
          attrs: { toolName: t.name },
          content: [{ type: 'text', text: parameterSkeleton(t) }],
        }).run()
      },
    }))
    const q = query.toLowerCase()
    return [...base, ...toolItems].filter((i) => i.title.toLowerCase().includes(q)).slice(0, 10)
  }, [])

  const sendRef = useRef<() => void>(() => {})

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, blockquote: false, bulletList: false, orderedList: false, horizontalRule: false, codeBlock: false }),
      ThinkingBlock,
      ToolCallBlock,
      SlashMenu.configure({ getItems }),
      Placeholder.configure({
        placeholder: 'LLM として出力を書く… 「/」でブロック挿入、<thinking> を生で打ってもOK',
      }),
    ],
    editorProps: {
      attributes: { class: 'rich-editor-content' },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          sendRef.current()
          return true
        }
        return false
      },
    },
  })

  // 外部(ダイアグラムエディタ等)からテキストを末尾に挿入できるようにする
  useEffect(() => {
    if (!editor || !onEditorReady) return
    onEditorReady((text: string) => {
      const paragraphs = text.split('\n').map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
      }))
      editor.chain().focus('end').insertContent(paragraphs).run()
    })
  }, [editor, onEditorReady])

  // エディタの内容を Claude 方言の raw テキストに直列化してパースする
  const parse = (): ParsedTurn | null => {
    if (!editor) return null
    const parts: string[] = []
    editor.state.doc.forEach((node) => {
      const text = node.textContent
      if (node.type.name === 'thinkingBlock') {
        parts.push(`<thinking>\n${text}\n</thinking>`)
      } else if (node.type.name === 'toolCallBlock') {
        parts.push(`<function_calls>\n<invoke name="${node.attrs.toolName}">\n${text}\n</invoke>\n</function_calls>`)
      } else if (text.trim()) {
        parts.push(text)
      }
    })
    return parseRawOutput(parts.join('\n'))
  }

  const handleSend = () => {
    const parsed = parse()
    if (!parsed) return
    if (!parsed.thoughts.length && !parsed.tool && !parsed.finalText) return
    if (parsed.tool && parsed.finalText) {
      parsed.warnings.push('tool call と final output の同時送信は不可 — tool call を優先し、本文は破棄しました')
      parsed.finalText = ''
    }
    setWarnings(parsed.warnings)
    onSendTurn(parsed)
    editor?.commands.clearContent()
  }
  sendRef.current = handleSend

  const handleProgress = () => {
    const parsed = parse()
    if (!parsed) return
    if (parsed.tool) {
      setWarnings(['途中経過に tool call は含められません — Send で送信してください'])
      return
    }
    if (!parsed.thoughts.length && !parsed.finalText) return
    setWarnings(parsed.warnings)
    onProgress(parsed)
    editor?.commands.clearContent()
  }

  return (
    <div className="response-input">
      <div className="response-input-header">
        <div className="response-input-label">Raw output</div>
        <span className="thinking-timer" title="このリクエストが届いてからの経過時間">🧠 {formatElapsed(elapsed)}</span>
      </div>

      {tools.length > 0 && (
        <div className="tools-chips">
          <span className="tools-chips-label">Available tools:</span>
          {tools.map((t) => (
            <button
              key={t.name}
              className="tool-chip"
              title={t.description ?? t.name}
              disabled={disabled}
              onClick={() => editor?.chain().focus().insertContent({
                type: 'toolCallBlock',
                attrs: { toolName: t.name },
                content: [{ type: 'text', text: parameterSkeleton(t) }],
              }).run()}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      <div className={`rich-editor${disabled ? ' disabled' : ''}`}>
        <EditorContent editor={editor} />
      </div>

      {warnings.length > 0 && (
        <div className="parse-warnings">
          {warnings.map((w, i) => <div key={i} className="parse-warning">{w}</div>)}
        </div>
      )}

      <div className="response-actions">
        <span className="response-hint">/ でブロック挿入 · Cmd+Enter で送信</span>
        <button className="response-delta" onClick={handleProgress} disabled={disabled}>
          Send progress
        </button>
        <button className="response-submit" onClick={handleSend} disabled={disabled}>
          Send
        </button>
      </div>
    </div>
  )
}
