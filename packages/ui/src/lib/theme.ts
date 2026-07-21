import { useCallback, useEffect, useState } from 'react'

// カラーモード(system / light / dark)の永続化と :root[data-theme] 制御。
//  - system … data-theme を外し prefers-color-scheme に委譲(tokens.css がこの構造)
//  - light  … data-theme="light"
//  - dark   … data-theme="dark"
// FOUC 防止のため初期適用は index.html の head インラインスクリプトでも行う(同じキー・規約)。

export type ThemeMode = 'system' | 'light' | 'dark'

export const THEME_KEY = 'human-1-theme'

export function getThemeMode(): ThemeMode {
  try {
    const v = window.localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // localStorage 不可(プライベートモード等)は system 既定
  }
  return 'system'
}

// data-theme を実際に反映する。head のインラインスクリプトと同一ロジック。
export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_KEY, mode)
  } catch {
    // 保存できなくても適用は行う
  }
  applyThemeMode(mode)
}

// 現在のモードと切替関数を返すフック。初期値は localStorage、変更で即 data-theme 反映。
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(() => getThemeMode())

  // マウント時、head スクリプト適用済みでも React 状態と DOM を確実に一致させる。
  useEffect(() => {
    applyThemeMode(mode)
  }, [mode])

  const update = useCallback((next: ThemeMode) => {
    setThemeMode(next)
    setMode(next)
  }, [])

  return [mode, update]
}
