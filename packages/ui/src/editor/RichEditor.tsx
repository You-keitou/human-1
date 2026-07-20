import { type ParsedTurn, parseRawOutput, type ToolInfo } from '@human-1/shared'
import { type Editor, Extension, Node, type Range, textblockTypeInputRule } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { PluginKey } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Suggestion from '@tiptap/suggestion'
import { type ReactElement, useEffect, useMemo, useRef } from 'react'
import './editor.css'

// PoC RichResponseInput.tsx を移植・進化。旧内蔵パーサは使わず shared の parseRawOutput
// (並列複数 tool call 対応)へ委譲する。ThinkingBlock / ToolCallBlock(raw タグ入力 input rule・
// スラッシュメニュー・tool chips)を提供し、Cmd+Enter で送信する。

// <thinking> ブロック。タグの見た目は CSS ::before/::after で描く。
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
    // 生で `<thinking>` と打って改行/スペースするとブロック化する。
    return [textblockTypeInputRule({ find: /^<thinking>[\s\n]$/, type: this.type })]
  },
})

// <function_calls><invoke name="X"> ブロック。中身は <parameter> タグ(または JSON)。
const ToolCallBlock = Node.create({
  name: 'toolCallBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  addAttributes() {
    return { toolName: { default: 'exec_command' } }
  },
  parseHTML() {
    return [
      {
        tag: 'pre[data-tool-call]',
        getAttrs: (el) => ({
          toolName: (el as HTMLElement).getAttribute('data-tool-call') ?? 'exec_command',
        }),
      },
    ]
  },
  renderHTML({ node }) {
    return ['pre', { 'data-tool-call': node.attrs.toolName, class: 'rt-toolcall' }, ['code', 0]]
  },
})

type SlashItem = { title: string; hint: string; run: (editor: Editor, range: Range) => void }

const SlashMenu = Extension.create<{ getItems: (query: string) => SlashItem[] }>({
  name: 'slashMenu',
  addOptions() {
    return { getItems: () => [] }
  },
  addProseMirrorPlugins() {
    let el: HTMLDivElement | null = null
    let items: SlashItem[] = []
    let selected = 0
    let command: ((item: SlashItem) => void) | null = null

    const destroy = (): void => {
      el?.remove()
      el = null
    }
    const renderList = (clientRect?: (() => DOMRect | null) | null): void => {
      if (!el) return
      el.innerHTML = ''
      items.forEach((item, i) => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = `slash-item${i === selected ? ' selected' : ''}`
        const title = document.createElement('span')
        title.className = 'slash-title'
        title.textContent = item.title
        const hint = document.createElement('span')
        hint.className = 'slash-hint'
        hint.textContent = item.hint
        row.append(title, hint)
        row.addEventListener('mousedown', (e) => {
          e.preventDefault()
          command?.(item)
        })
        el?.appendChild(row)
      })
      const rect = clientRect?.()
      if (rect) {
        el.style.left = `${rect.left}px`
        el.style.top = `${rect.bottom + 4}px`
      }
    }

    return [
      Suggestion<SlashItem>({
        pluginKey: new PluginKey('slashMenu'),
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        command: ({ editor, range, props }) => props.run(editor as Editor, range),
        items: ({ query }) => this.options.getItems(query),
        render: () => ({
          onStart: (props) => {
            el = document.createElement('div')
            el.className = 'slash-menu'
            document.body.appendChild(el)
            items = props.items
            selected = 0
            command = (item) => props.command(item)
            renderList(props.clientRect)
          },
          onUpdate: (props) => {
            items = props.items
            selected = Math.min(selected, Math.max(0, items.length - 1))
            command = (item) => props.command(item)
            renderList(props.clientRect)
          },
          onKeyDown: ({ event }) => {
            if (!el || items.length === 0) return false
            if (event.key === 'ArrowDown') {
              selected = (selected + 1) % items.length
              renderList()
              return true
            }
            if (event.key === 'ArrowUp') {
              selected = (selected - 1 + items.length) % items.length
              renderList()
              return true
            }
            if (event.key === 'Enter') {
              const item = items[selected]
              if (item) command?.(item)
              return true
            }
            if (event.key === 'Escape') {
              destroy()
              return true
            }
            return false
          },
          onExit: destroy,
        }),
      }),
    ]
  },
})

// ツールスキーマから <parameter> の雛形を作る。
function parameterSkeleton(tool: ToolInfo): string {
  const schema = tool.parameters as
    | { properties?: Record<string, unknown>; required?: string[] }
    | undefined
  const keys = schema?.required?.length
    ? schema.required
    : Object.keys(schema?.properties ?? {}).slice(0, 2)
  if (!keys.length) return '<parameter name=""></parameter>'
  return keys.map((k) => `<parameter name="${k}"></parameter>`).join('\n')
}

export type RichEditorHandle = {
  insert: (text: string) => void
  clear: () => void
  send: () => void
}

type Props = {
  tools: ToolInfo[]
  disabled?: boolean
  onSend: (parsed: ParsedTurn) => void
  onReady?: (handle: RichEditorHandle) => void
}

export function RichEditor({ tools, disabled, onSend, onReady }: Props): ReactElement {
  const toolsRef = useRef(tools)
  toolsRef.current = tools
  const sendRef = useRef<() => void>(() => {})

  const getItems = useMemo(
    () =>
      (query: string): SlashItem[] => {
        const base: SlashItem[] = [
          {
            title: 'thinking',
            hint: '<thinking> 思考ブロック',
            run: (editor, range) => {
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent({ type: 'thinkingBlock' })
                .run()
            },
          },
        ]
        const toolItems: SlashItem[] = toolsRef.current.map((t) => ({
          title: t.name,
          hint: (t.description ?? 'tool call').slice(0, 48),
          run: (editor, range) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: 'toolCallBlock',
                attrs: { toolName: t.name },
                content: [{ type: 'text', text: parameterSkeleton(t) }],
              })
              .run()
          },
        }))
        const q = query.toLowerCase()
        return [...base, ...toolItems].filter((i) => i.title.toLowerCase().includes(q)).slice(0, 10)
      },
    [],
  )

  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        horizontalRule: false,
        codeBlock: false,
      }),
      ThinkingBlock,
      ToolCallBlock,
      SlashMenu.configure({ getItems }),
      Placeholder.configure({
        placeholder:
          'LLM として出力を書く… 「/」でブロック挿入、<thinking> を生で打っても OK。並列 tool は invoke ブロックを複数。',
      }),
    ],
    editorProps: {
      attributes: { class: 'rich-editor-content', 'aria-label': 'LLM 出力エディタ' },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          sendRef.current()
          return true
        }
        return false
      },
    },
  })

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  // エディタ内容 → Claude 方言の raw テキストへ直列化。並列 tool は複数の function_calls 対で表現する。
  const serialize = (): string => {
    if (!editor) return ''
    const parts: string[] = []
    editor.state.doc.forEach((node) => {
      const text = node.textContent
      if (node.type.name === 'thinkingBlock') {
        parts.push(`<thinking>\n${text}\n</thinking>`)
      } else if (node.type.name === 'toolCallBlock') {
        parts.push(
          `<function_calls>\n<invoke name="${node.attrs.toolName}">\n${text}\n</invoke>\n</function_calls>`,
        )
      } else if (text.trim()) {
        parts.push(text)
      }
    })
    return parts.join('\n')
  }

  const handleSend = (): void => {
    if (disabled || !editor) return
    const parsed = parseRawOutput(serialize())
    if (!parsed.thoughts.length && !parsed.toolCalls.length && !parsed.finalText) return
    onSend(parsed)
  }
  sendRef.current = handleSend

  const insertTool = (tool: ToolInfo): void => {
    editor
      ?.chain()
      .focus()
      .insertContent({
        type: 'toolCallBlock',
        attrs: { toolName: tool.name },
        content: [{ type: 'text', text: parameterSkeleton(tool) }],
      })
      .run()
  }

  // 外部(ホワイトボードの Mermaid 挿入)からテキストを末尾へ差し込むハンドル。
  useEffect(() => {
    if (!editor || !onReady) return
    onReady({
      insert: (text: string) => {
        const paragraphs = text.split('\n').map((line) => ({
          type: 'paragraph',
          content: line ? [{ type: 'text', text: line }] : [],
        }))
        editor.chain().focus('end').insertContent(paragraphs).run()
      },
      clear: () => editor.commands.clearContent(),
      send: () => sendRef.current(),
    })
  }, [editor, onReady])

  return (
    <div className="rich-editor-root">
      {tools.length > 0 && (
        <div className="tools-chips">
          <span className="tools-chips-label">tools:</span>
          {tools.map((t) => (
            <button
              key={t.name}
              type="button"
              className="tool-chip"
              title={t.description ?? t.name}
              disabled={disabled}
              onClick={() => insertTool(t)}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
      <div className={`rich-editor${disabled ? ' disabled' : ''}`}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
