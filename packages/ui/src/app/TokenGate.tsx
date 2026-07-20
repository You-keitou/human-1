import { type FormEvent, type ReactElement, type ReactNode, useState } from 'react'
import { getToken, setToken } from '../lib/auth'
import { Frame, Text } from '../ui/primitives'

// トークン未設定時の簡易入力ゲート(CLAUDE.md: UI は localStorage にトークン保持)。
// 設定済みなら children(実アプリ)を token 付きで描画する。
export function TokenGate({ children }: { children: (token: string) => ReactNode }): ReactElement {
  const [token, setTok] = useState<string | null>(() => getToken())
  const [draft, setDraft] = useState('')

  if (token) return <>{children(token)}</>

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const t = draft.trim()
    if (!t) return
    setToken(t)
    setTok(t)
  }

  return (
    <Frame
      dir="col"
      w="fill"
      align="center"
      justify="center"
      gap={18}
      style={{ minHeight: '100vh', padding: 24 }}
    >
      <Frame
        dir="col"
        gap={14}
        pad={28}
        w={380}
        fill="var(--surface)"
        border={[1, 'var(--border)']}
        radius={12}
        align="start"
      >
        <span
          data-testid="app-title"
          style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600 }}
        >
          human-1
        </span>
        <Text size={13} color="var(--text-secondary)" lh={1.5}>
          アクセストークンを入力してください。ブラウザの localStorage に保存されます。
        </Text>
        <form
          onSubmit={submit}
          style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="AUTH_TOKEN"
            aria-label="アクセストークン"
            style={{
              width: '100%',
              padding: '10px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              background: 'var(--bg)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            type="submit"
            style={{
              padding: '10px 16px',
              fontFamily: 'var(--font-ui)',
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--on-accent)',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            接続
          </button>
        </form>
      </Frame>
    </Frame>
  )
}
