// トレーナー AI の採点タグ [SCORE: x.x/10] の抽出。
// タグは必須(CLAUDE.md 決定事項)— 見つからなければ null を返し、呼び出し側で再要求する。

export type ExtractedScore = {
  value: number
  max: number
}

const SCORE_RE = /\[SCORE:\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\]/i

export function extractScore(text: string): ExtractedScore | null {
  const m = SCORE_RE.exec(text)
  if (!m) return null
  const value = Number(m[1])
  const max = Number(m[2])
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return null
  return { value, max }
}
