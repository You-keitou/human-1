// Claude 方言の寛容パーサ。
// PoC(RichResponseInput.tsx の parseRawOutput)から移植し、
// 並列複数 tool call に対応させたもの。
//
// 記法: <thinking>…</thinking> / <function_calls><invoke name="X">
//        <parameter name="y">…</parameter></invoke></function_calls> / タグ外テキスト = final
// 崩れたタグはパースせず警告を出して本文扱いにする。

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

export function parseRawOutput(raw: string): ParsedTurn {
  const thoughts: string[] = []
  const toolCalls: ParsedToolCall[] = []
  const warnings: string[] = []

  let rest = raw.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (_m, t: string) => {
    if (t.trim()) thoughts.push(t.trim())
    return ''
  })

  rest = rest.replace(
    /(?:<function_calls>\s*)?<invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/invoke>\s*(?:<\/function_calls>)?/gi,
    (_m, name: string, body: string) => {
      const args: Record<string, unknown> = {}
      const re = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/gi
      let m: RegExpExecArray | null
      let found = false
      while ((m = re.exec(body))) {
        args[m[1]!] = m[2]!.trim()
        found = true
      }
      if (!found) {
        const t = body.trim()
        if (t.startsWith('{')) {
          try {
            Object.assign(args, JSON.parse(t))
            found = true
          } catch {
            /* fallthrough */
          }
        }
      }
      if (!found && body.trim()) {
        warnings.push(`invoke "${name}" の <parameter> をパースできず、引数なしで送信します`)
      }
      toolCalls.push({ name, args })
      return ''
    },
  )

  // 事故検出: 崩れたタグの残骸(パースをすり抜けて本文として送信される)
  if (/<\/?invoke|<\/?function_calls|<\/?parameter/i.test(rest)) {
    warnings.push('⚠ 崩れた <invoke> タグを検出 — パースされず本文として漏れます')
  }
  if (/<\/?think/i.test(rest)) {
    warnings.push('⚠ 崩れた <thinking> タグを検出 — 本文として漏れます')
  }

  return { thoughts, toolCalls, finalText: rest.trim(), warnings }
}
