// 単一シークレットトークンの保管。認証は Bearer / x-api-key(REST)と ?token=(WS)。
// UI は localStorage に保持し、未設定時は簡易トークン入力ゲートを出す(CLAUDE.md 決定事項)。

const KEY = 'human-1-token'

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token)
  } catch {
    // localStorage 不可(プライベートモード等)でも致命ではない
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // no-op
  }
}

// REST 用の認証ヘッダ。
export function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}
