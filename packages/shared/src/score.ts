// トレーナー AI の採点タグ [SCORE: x.x/10] の抽出。
// タグは必須(CLAUDE.md 決定事項)— 見つからなければ null を返し、呼び出し側で再要求する。
//
// 厳格側に倒す:
//   - スケールは /10 固定。max が 10 でない、または value が 0..10 の範囲外なら null を返す
//     (トレーナーは AI なので、不正な採点は再要求すればよい)。
//   - タグが複数ある場合は「最後の候補」を採用し、それを範囲検証にかける
//     (「最後の有効値」ではなく「最後の候補を検証」。トレーナーの訂正を後勝ちで反映)。
//   - そのため候補の捕捉は符号付き数値まで広げる。負値を捕捉できないと、末尾の負値タグが
//     「候補」から漏れて手前の有効タグが誤って残ってしまう(last-tag-wins が崩れる)。

export type ExtractedScore = {
  value: number
  max: number
}

// 候補は符号付き数値で寛容に捕捉し、閉じ括弧前の空白 `[SCORE: 0 / 10 ]` も許容する。
const SCORE_RE = /\[SCORE:\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*\]/gi

export function extractScore(text: string): ExtractedScore | null {
  const re = new RegExp(SCORE_RE.source, 'gi')
  let last: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) last = m
  if (!last) return null

  const value = Number(last[1])
  const max = Number(last[2])
  if (!Number.isFinite(value) || !Number.isFinite(max)) return null
  if (max !== 10) return null
  if (value < 0 || value > 10) return null
  return { value, max }
}
