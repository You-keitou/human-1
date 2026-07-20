// Claude 方言の寛容パーサ。
// PoC(RichResponseInput.tsx の parseRawOutput)から移植したものを、
// regex の cross-tag 一括置換から「タグ境界を線形走査するトークナイザ+ステートマシン」に
// 書き換えたもの。regex 置換は未閉鎖 invoke の lazy 誤ペアリングや、値内リテラル閉じタグでの
// 無警告データ欠損を起こしていた。トークナイザ化でこれらを警告付き・非破壊で扱う。
//
// 記法: <thinking>…</thinking> / <function_calls><invoke name="X">
//        <parameter name="y">…</parameter></invoke></function_calls> / タグ外テキスト = final
// 崩れたタグはパースせず警告を出して本文扱いにする。無警告のデータ欠損は絶対に許さない。
//
// 既知の制約(エスケープ契約は未定義): final text 内にリテラルの Claude 方言タグ
// (<thinking> / <invoke> 等)を書くと構文として解釈される。XML エンティティ(&lt; 等)は
// デコードしない。エスケープが必要になった時点で契約を定義する。
//
// ステートマシン概要:
//   tokenize()  … raw を text / open / close トークンの平坦列へ。開始タグの属性は寛容に解釈
//                 (name は "…" / '…' / 素の値どれも可、未知属性は無視、<thinking signature="…"> も可)
//   parseRawOutput() … トークン列を左から走査:
//     - text            → finalText へ
//     - open think(ing) → 同じ綴りの close まで(綴り厳密)。取れなければ未閉鎖として本文+警告
//     - open invoke     → ボディを parseInvoke で構造解析。取れなければ本文+警告
//     - function_calls  … 釣り合う対のみ透過スキップ。孤立は本文+警告
//     - 孤立 close / invoke 外 parameter → 本文+警告
//   parseInvoke()   … parameter 列を解析。閉じ後、param 無し時のみ JSON ボディへフォールバック。
//                     param 以外の非空白残余があれば警告
//   parseParamValue() … <parameter> の値を収集。</parameter> は「直後(空白のみ挟む)が
//                       次の <parameter> / </invoke> / 入力終端」の時のみ真の終端。それ以外の
//                       リテラル </parameter> / </invoke> / <parameter> は値へ保持しつつ警告

export type ParsedToolCall = {
  name: string
  args: Record<string, unknown>
}

export type ParsedTurn = {
  thoughts: string[]
  toolCalls: ParsedToolCall[]
  finalText: string
  warnings: string[]
}

type TagName = 'think' | 'thinking' | 'function_calls' | 'invoke' | 'parameter'

type Token =
  | { type: 'text'; raw: string }
  | { type: 'open'; tag: TagName; name?: string; raw: string }
  | { type: 'close'; tag: TagName; raw: string }

// 認識するタグだけを拾う。属性値に < / > は含めない前提(寛容だが崩れ過ぎには踏み込まない)。
const TAG_RE = /<\/?(?:think(?:ing)?|function_calls|invoke|parameter)\b[^<>]*>/gi

// 開始タグの name 属性を寛容に抽出("…" / '…' / 素の値)。
function parseNameAttr(attrs: string): string | undefined {
  const m = attrs.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))/i)
  if (!m) return undefined
  return m[1] ?? m[2] ?? m[3]
}

function classifyTag(raw: string): Token {
  const isClose = raw[1] === '/'
  const head = raw.match(/^<\/?\s*([a-z_]+)/i)
  const tag = (head?.[1] ?? '').toLowerCase() as TagName
  if (isClose) return { type: 'close', tag, raw }
  const attrs = raw.slice((head?.[0] ?? '').length, raw.length - 1)
  return { type: 'open', tag, name: parseNameAttr(attrs), raw }
}

function tokenize(raw: string): Token[] {
  const tokens: Token[] = []
  const re = new RegExp(TAG_RE.source, 'gi')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    if (m.index > last) tokens.push({ type: 'text', raw: raw.slice(last, m.index) })
    tokens.push(classifyTag(m[0]))
    last = re.lastIndex
  }
  if (last < raw.length) tokens.push({ type: 'text', raw: raw.slice(last) })
  return tokens
}

const isWhitespace = (t: Token): boolean => t.type === 'text' && t.raw.trim() === ''

function truncate(s: string, n = 60): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n)}…` : one
}

export function parseRawOutput(raw: string): ParsedTurn {
  const thoughts: string[] = []
  const toolCalls: ParsedToolCall[] = []
  const warnings: string[] = []
  const finalParts: string[] = []

  const tokens = tokenize(raw)

  // <function_calls> の釣り合い(括弧対応)を先に算出。対応が取れた対だけ透過スキップする。
  const fcMatched = new Set<number>()
  const fcStack: number[] = []
  tokens.forEach((t, idx) => {
    if (t.type === 'open' && t.tag === 'function_calls') fcStack.push(idx)
    else if (t.type === 'close' && t.tag === 'function_calls' && fcStack.length > 0) {
      fcMatched.add(fcStack.pop() as number)
      fcMatched.add(idx)
    }
  })

  // from から見て最初の非空白トークンの位置(無ければ tokens.length)。
  const skipWhitespace = (from: number): number => {
    let j = from
    while (j < tokens.length && isWhitespace(tokens[j] as Token)) j++
    return j
  }

  // 各位置から見た「次の </parameter>」「次の open <invoke>」を右から O(n) で前計算する。
  // これで hasLaterParamClose を O(1) にし、値内に裸 </invoke> を大量に含む退化入力の
  // O(n²) 走査を解消する。
  const INF = Number.POSITIVE_INFINITY
  const nextParamClose = new Array<number>(tokens.length + 1).fill(INF)
  const nextOpenInvoke = new Array<number>(tokens.length + 1).fill(INF)
  for (let idx = tokens.length - 1; idx >= 0; idx--) {
    const t = tokens[idx] as Token
    nextParamClose[idx] =
      t.type === 'close' && t.tag === 'parameter' ? idx : (nextParamClose[idx + 1] as number)
    nextOpenInvoke[idx] =
      t.type === 'open' && t.tag === 'invoke' ? idx : (nextOpenInvoke[idx + 1] as number)
  }

  // この invoke ボディ内(= 次の open <invoke> より前)に </parameter> が残っているか。
  // 次の invocation まで走査すると、隣接する別 invoke の </parameter> を誤って拾い、
  // 現 invoke の </invoke> をリテラル扱いして次の invoke を丸ごと飲み込んでしまう。
  // 「次の </parameter> が次の open invoke より手前にあるか」を前計算配列で O(1) 判定する。
  const hasLaterParamClose = (from: number): boolean =>
    (nextParamClose[from] as number) < (nextOpenInvoke[from] as number)

  // <parameter> の値を valueStart(開始タグの次)から収集する。
  // 戻り値 next は次に読むべきトークン位置。closed は真の </parameter> で閉じたか。
  const parseParamValue = (
    valueStart: number,
  ): { value: string; next: number; closed: boolean } => {
    const parts: string[] = []
    let j = valueStart
    while (j < tokens.length) {
      const t = tokens[j] as Token
      if (t.type === 'close' && t.tag === 'parameter') {
        const k = skipWhitespace(j + 1)
        const nx = tokens[k]
        const terminates =
          k >= tokens.length ||
          (nx?.type === 'open' && nx.tag === 'parameter') ||
          (nx?.type === 'close' && nx.tag === 'invoke')
        if (terminates) return { value: parts.join(''), next: j + 1, closed: true }
        // 真の終端ではない → 値内リテラルとして保持しつつ警告(無警告欠損を防ぐ)。
        warnings.push(
          '⚠ parameter 値内のリテラル </parameter> を検出 — 値として保持しますが区切りが曖昧です',
        )
        parts.push(t.raw)
        j++
        continue
      }
      if (t.type === 'close' && t.tag === 'invoke') {
        // まだ後方に </parameter> が残るならリテラルとして値に含め、無ければ invoke の真の終端。
        if (hasLaterParamClose(j + 1)) {
          warnings.push('⚠ parameter 値内のリテラル </invoke> を検出 — 値として保持します')
          parts.push(t.raw)
          j++
          continue
        }
        return { value: parts.join(''), next: j, closed: false }
      }
      if (t.type === 'open' && t.tag === 'invoke') {
        // 値の途中に開始 <invoke> = 現 parameter が閉じないまま次の invocation が始まった。
        // 構造未閉鎖として直前で終端し(closed=false)、この位置から次の invoke を再走査させる。
        // 開き先行のケースも閉じ先行と同じ broken パスへ合流し、埋め込まれた invoke を欠損させない。
        return { value: parts.join(''), next: j, closed: false }
      }
      if (t.type === 'open' && t.tag === 'parameter') {
        // 値の途中に現れる開始 <parameter> は直前パラメータの閉じ忘れの可能性 → 保持+警告。
        warnings.push(
          '⚠ parameter 値内にリテラル <parameter> を検出 — 値として保持しますが区切りが曖昧です',
        )
      }
      parts.push(t.raw)
      j++
    }
    return { value: parts.join(''), next: j, closed: false }
  }

  // open invoke(openIdx)を構造解析。tool call を積めたら next=閉じ後、
  // 失敗(未閉鎖・入れ子 invoke)時は開始タグを本文へ流し、next=openIdx+1 で再走査に戻す。
  const parseInvoke = (openIdx: number): number => {
    const openTok = tokens[openIdx] as Extract<Token, { type: 'open' }>
    const name = openTok.name
    if (!name) {
      warnings.push('⚠ name 属性のない <invoke> を検出 — 本文として扱います')
      finalParts.push(openTok.raw)
      return openIdx + 1
    }

    const args: Record<string, unknown> = {}
    const residue: string[] = []
    let hasParam = false
    let closed = false
    // 構造的に閉じられていない parameter や入れ子 invoke を検出したら invocation 全体を無効化する。
    // 「崩れタグは警告して本文扱い」の契約に従い、壊れた invocation は tool call にしない。
    let broken = false
    let j = openIdx + 1

    // openIdx..end までの raw を連結して本文へ戻すためのヘルパ。
    const leakRange = (end: number): void => {
      let raw = ''
      for (let k = openIdx; k < end; k++) raw += (tokens[k] as Token).raw
      finalParts.push(raw)
    }

    while (j < tokens.length) {
      const t = tokens[j] as Token
      if (t.type === 'close' && t.tag === 'invoke') {
        closed = true
        j++
        break
      }
      if (t.type === 'open' && t.tag === 'invoke') {
        // 入れ子 invoke = 現 invoke が閉じないまま次が始まった → 構造未閉鎖として無効化。
        warnings.push(
          `⚠ 未閉鎖の <invoke name="${name}"> を検出(入れ子 invoke)— 本文として扱います`,
        )
        broken = true
        break
      }
      if (isWhitespace(t)) {
        j++
        continue
      }
      if (t.type === 'open' && t.tag === 'parameter') {
        if (!t.name) {
          warnings.push(`⚠ invoke "${name}" に name 属性のない <parameter> — 無視します`)
          residue.push(t.raw)
          j++
          continue
        }
        const { value, next, closed: paramClosed } = parseParamValue(j + 1)
        if (!paramClosed) {
          // 構造的に閉じていない parameter。値内リテラルで最終的に閉じた(closed=true)ものとは区別し、
          // この invocation 全体を無効化して本文へ戻す(値は原文として保持されるので欠損しない)。
          broken = true
          warnings.push(
            `⚠ invoke "${name}" の parameter "${t.name}" が構造的に閉じられていません — この invocation 全体を本文として扱います`,
          )
          j = next
          continue
        }
        args[t.name] = value.trim()
        hasParam = true
        j = next
        continue
      }
      // それ以外(非空白 text・孤立 </parameter>・function_calls 等)はボディ残余として集める。
      residue.push(t.raw)
      j++
    }

    if (broken) {
      // 消費した範囲(開始タグ〜直近まで)を原文のまま本文へ戻す。後続の正常な invoke は独立に再走査される。
      leakRange(j)
      return j
    }

    if (!closed) {
      warnings.push(`⚠ 未閉鎖の <invoke name="${name}"> を検出 — パースせず本文として扱います`)
      leakRange(j)
      return j
    }

    const residueText = residue.join('').trim()
    if (!hasParam) {
      if (residueText.startsWith('{')) {
        try {
          Object.assign(args, JSON.parse(residueText))
          toolCalls.push({ name, args })
          return j
        } catch {
          /* JSON でなかった → 下で警告 */
        }
      }
      if (residueText) {
        warnings.push(`⚠ invoke "${name}" の <parameter> をパースできず、引数なしで送信します`)
      }
      toolCalls.push({ name, args })
      return j
    }

    if (residueText) {
      warnings.push(
        `⚠ invoke "${name}" のボディに parameter 以外の残余があります — 無視: ${truncate(residueText)}`,
      )
    }
    toolCalls.push({ name, args })
    return j
  }

  // open think/thinking(openIdx)を解析。綴りが一致する close までを本文とみなす。
  const parseThinking = (openIdx: number): number => {
    const openTok = tokens[openIdx] as Extract<Token, { type: 'open' }>
    const word = openTok.tag
    const parts: string[] = []
    let depth = 1
    let j = openIdx + 1
    while (j < tokens.length) {
      const t = tokens[j] as Token
      if (t.type === 'open' && t.tag === word) {
        depth++
        parts.push(t.raw)
        j++
        continue
      }
      if (t.type === 'close' && t.tag === word) {
        depth--
        if (depth === 0) {
          const content = parts.join('').trim()
          if (content) thoughts.push(content)
          return j + 1
        }
        parts.push(t.raw)
        j++
        continue
      }
      parts.push(t.raw)
      j++
    }
    warnings.push(`⚠ 未閉鎖(または綴り不一致)の <${word}> thinking タグを検出 — 本文として扱います`)
    finalParts.push(openTok.raw)
    return openIdx + 1
  }

  let i = 0
  while (i < tokens.length) {
    const t = tokens[i] as Token
    if (t.type === 'text') {
      finalParts.push(t.raw)
      i++
      continue
    }
    if (t.type === 'open' && (t.tag === 'think' || t.tag === 'thinking')) {
      i = parseThinking(i)
      continue
    }
    if (t.type === 'open' && t.tag === 'invoke') {
      i = parseInvoke(i)
      continue
    }
    if (t.tag === 'function_calls') {
      if (fcMatched.has(i)) {
        i++
        continue
      }
      warnings.push('⚠ 対応の取れない <function_calls> タグを検出 — 本文として扱います')
      finalParts.push(t.raw)
      i++
      continue
    }
    if (t.type === 'open' && t.tag === 'parameter') {
      warnings.push('⚠ invoke の外にある <parameter> を検出 — 本文として扱います')
      finalParts.push(t.raw)
      i++
      continue
    }
    // 残りは孤立した閉じタグ(think/thinking/invoke/parameter)。
    warnings.push(`⚠ 対応の取れない </${t.tag}> タグを検出 — 本文として扱います`)
    finalParts.push(t.raw)
    i++
  }

  return { thoughts, toolCalls, finalText: finalParts.join('').trim(), warnings }
}
