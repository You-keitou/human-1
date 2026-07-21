import { type LucideIcon, Monitor, Moon, Sun } from 'lucide-react'
import type { ReactElement } from 'react'
import { type ThemeMode, useThemeMode } from '../lib/theme'

// system / light / dark の 3 値スイッチャ。localStorage 永続化 + :root[data-theme] 制御は
// lib/theme.ts が担う。role=radiogroup / aria-checked を使う(aria-pressed は左パネルの
// pending チップ選択に予約されているため衝突させない)。

const THEME_OPTIONS: { mode: ThemeMode; label: string; Icon: LucideIcon }[] = [
  { mode: 'system', label: 'システム設定に合わせる', Icon: Monitor },
  { mode: 'light', label: 'ライトモード', Icon: Sun },
  { mode: 'dark', label: 'ダークモード', Icon: Moon },
]

export function ThemeSwitcher({ compact = false }: { compact?: boolean }): ReactElement {
  const [mode, setMode] = useThemeMode()
  const btn = compact ? 24 : 26
  const icon = compact ? 13 : 14
  return (
    <div
      role="radiogroup"
      aria-label="カラーモード"
      style={{
        display: 'flex',
        gap: 2,
        padding: 2,
        borderRadius: 999,
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      {THEME_OPTIONS.map(({ mode: m, label, Icon }) => {
        const active = mode === m
        return (
          // biome-ignore lint/a11y/useSemanticElements: セグメンテッドコントロールは radiogroup/radio が適切(aria-pressed は左パネルの pending チップ選択に予約)
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setMode(m)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: btn,
              height: btn,
              padding: 0,
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? 'var(--on-accent)' : 'var(--text-muted)',
            }}
          >
            <Icon size={icon} strokeWidth={2} style={{ display: 'block' }} />
          </button>
        )
      })}
    </div>
  )
}
