import { useState, useRef, useEffect } from 'react'
import type { ToolInfo } from '../../shared/types'

type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onDelta: () => void
  onReasoning: (text: string) => void
  onCommand: (command: string[], workingDirectory: string | null) => void
  onFunctionCall: (name: string, args: string) => void
  tools: ToolInfo[]
  requestCreatedAt: number
  disabled: boolean
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function ResponseInput({ value, onChange, onSubmit, onDelta, onReasoning, onCommand, onFunctionCall, tools, requestCreatedAt, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [toolMode, setToolMode] = useState<'function_call' | 'local_shell_call' | null>(null)
  const [fnName, setFnName] = useState('')
  const [fnArgs, setFnArgs] = useState('{}')
  const [shellCmd, setShellCmd] = useState('')
  const [shellDir, setShellDir] = useState('')

  // 思考モード: 打った内容は reasoning としてストリームされ、相手には「考え中」として見える
  const [thinking, setThinking] = useState(false)
  const [thoughtText, setThoughtText] = useState('')
  const [sentThoughts, setSentThoughts] = useState<string[]>([])

  // 考える時間の可視化
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor(Date.now() / 1000) - requestCreatedAt))
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.max(0, Math.floor(Date.now() / 1000) - requestCreatedAt))
    }, 1000)
    return () => clearInterval(timer)
  }, [requestCreatedAt])

  useEffect(() => {
    if (!disabled) {
      textareaRef.current?.focus()
    }
  }, [disabled])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (!disabled && value.trim()) onSubmit()
    }
  }

  const handleToggleTool = (mode: 'function_call' | 'local_shell_call') => {
    setToolMode((prev) => (prev === mode ? null : mode))
  }

  const handleSendThought = () => {
    if (!thoughtText.trim()) return
    onReasoning(thoughtText)
    setSentThoughts((prev) => [...prev, thoughtText.trim()])
    setThoughtText('')
  }

  const handleThoughtKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSendThought()
    }
  }

  const handleSendShellCall = () => {
    if (!shellCmd.trim()) return
    const command = ['sh', '-c', shellCmd.trim()]
    const workingDirectory = shellDir.trim() || null
    onCommand(command, workingDirectory)
    setShellCmd('')
    setShellDir('')
    setToolMode(null)
  }

  const fnArgsValid = (() => {
    try { JSON.parse(fnArgs); return true } catch { return false }
  })()

  const handleSendFunctionCall = () => {
    if (!fnName.trim() || !fnArgsValid) return
    onFunctionCall(fnName, fnArgs)
    setFnName('')
    setFnArgs('{}')
    setToolMode(null)
  }

  const handlePickTool = (name: string) => {
    if (name === 'shell_command' || name === 'local_shell') {
      setToolMode('local_shell_call')
      return
    }
    setFnName(name)
    setToolMode('function_call')
  }

  return (
    <div className="response-input">
      <div className="response-input-header">
        <div className="response-input-label">Your response</div>
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
              onClick={() => handlePickTool(t.name)}
              disabled={disabled}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {thinking && !disabled && (
        <div className="thought-box">
          <div className="tool-form-title">thinking — 相手には「推論中」として流れます</div>
          {sentThoughts.length > 0 && (
            <div className="thought-history">
              {sentThoughts.map((t, i) => (
                <div key={i} className="thought-history-item">💭 {t}</div>
              ))}
            </div>
          )}
          <textarea
            className="thought-textarea"
            value={thoughtText}
            onChange={(e) => setThoughtText(e.target.value)}
            onKeyDown={handleThoughtKeyDown}
            placeholder={'**難問に遭遇** ← 太字で始めると相手のスピナー横に見出しが出る\nうーん、これは…(考えたことをそのまま送ると thinking として表示される)'}
            rows={3}
          />
          <div className="tool-form-actions">
            <button className="tool-form-send" onClick={handleSendThought} disabled={!thoughtText.trim()}>
              Send thought
            </button>
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="response-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? 'Select a request…' : 'Type your response…'}
        disabled={disabled}
        rows={6}
      />

      {toolMode === 'function_call' && !disabled && (
        <div className="tool-form">
          <div className="tool-form-title">function_call</div>
          <div className="tool-form-row">
            <label className="tool-form-label">name</label>
            <input
              className="tool-form-input"
              type="text"
              placeholder="write_file"
              value={fnName}
              onChange={(e) => setFnName(e.target.value)}
            />
          </div>
          <div className="tool-form-row">
            <label className="tool-form-label">arguments</label>
            <textarea
              className="tool-form-textarea"
              placeholder='{"path": "foo.txt", "content": "hello"}'
              value={fnArgs}
              onChange={(e) => setFnArgs(e.target.value)}
              rows={3}
            />
          </div>
          {(() => {
            const tool = tools.find((t) => t.name === fnName.trim())
            if (!tool?.parameters) return null
            return (
              <details className="tool-schema">
                <summary>parameters schema</summary>
                <pre>{JSON.stringify(tool.parameters, null, 2)}</pre>
              </details>
            )
          })()}
          <div className="tool-form-actions">
            <button className="tool-form-cancel" onClick={() => setToolMode(null)}>Cancel</button>
            <button
              className="tool-form-send"
              onClick={handleSendFunctionCall}
              disabled={!fnName.trim() || !fnArgsValid}
              title={fnArgsValid ? 'Send function call' : 'arguments が JSON として不正です'}
            >
              Send function call
            </button>
          </div>
        </div>
      )}

      {toolMode === 'local_shell_call' && !disabled && (
        <div className="tool-form">
          <div className="tool-form-title">local_shell_call</div>
          <div className="tool-form-row">
            <label className="tool-form-label">command</label>
            <input
              className="tool-form-input"
              type="text"
              placeholder="echo hello > foo.txt  (シェル構文が使えますわ)"
              value={shellCmd}
              onChange={(e) => setShellCmd(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSendShellCall() }}
            />
          </div>
          <div className="tool-form-row">
            <label className="tool-form-label">working_dir</label>
            <input
              className="tool-form-input"
              type="text"
              placeholder="/home/user  (optional)"
              value={shellDir}
              onChange={(e) => setShellDir(e.target.value)}
            />
          </div>
          <div className="tool-form-actions">
            <button className="tool-form-cancel" onClick={() => setToolMode(null)}>Cancel</button>
            <button className="tool-form-send sh-send" onClick={handleSendShellCall} disabled={!shellCmd.trim()}>
              Send command
            </button>
          </div>
        </div>
      )}

      <div className="response-actions">
        <span className="response-hint">Ctrl+Enter to send</span>
        <button
          className={`btn-tool-call btn-thinking${thinking ? ' active' : ''}`}
          onClick={() => setThinking((v) => !v)}
          disabled={disabled}
          title="思考モード: 考えたことを reasoning としてストリームする"
        >
          Thinking
        </button>
        <button
          className={`btn-tool-call btn-fn${toolMode === 'function_call' ? ' active' : ''}`}
          onClick={() => handleToggleTool('function_call')}
          disabled={disabled}
          title="Send Function Call"
        >
          Function Call
        </button>
        <button
          className={`btn-tool-call btn-shell${toolMode === 'local_shell_call' ? ' active' : ''}`}
          onClick={() => handleToggleTool('local_shell_call')}
          disabled={disabled}
          title="Send Command"
        >
          Run Command
        </button>
        <button
          className="response-delta"
          onClick={onDelta}
          disabled={disabled || !value.trim()}
        >
          Send progress
        </button>
        <button
          className="response-submit"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
        >
          Send
        </button>
      </div>
    </div>
  )
}
