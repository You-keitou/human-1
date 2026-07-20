import { describe, expect, test } from 'bun:test'
import { parseRawOutput } from '../src/parser'

describe('parseRawOutput', () => {
  test('タグなしテキストは final になる', () => {
    const r = parseRawOutput('こんにちは、これが回答です。')
    expect(r.thoughts).toEqual([])
    expect(r.toolCalls).toEqual([])
    expect(r.finalText).toBe('こんにちは、これが回答です。')
    expect(r.warnings).toEqual([])
  })

  test('thinking + final', () => {
    const r = parseRawOutput('<thinking>まず要件を整理する</thinking>\n結論はこうです。')
    expect(r.thoughts).toEqual(['まず要件を整理する'])
    expect(r.finalText).toBe('結論はこうです。')
  })

  test('<think> 省略形も受け付ける', () => {
    const r = parseRawOutput('<think>短縮タグ</think>OK')
    expect(r.thoughts).toEqual(['短縮タグ'])
    expect(r.finalText).toBe('OK')
  })

  test('thinking 複数ブロック', () => {
    const r = parseRawOutput('<thinking>一つ目</thinking><thinking>二つ目</thinking>')
    expect(r.thoughts).toEqual(['一つ目', '二つ目'])
    expect(r.finalText).toBe('')
  })

  test('parameter 付き invoke', () => {
    const r = parseRawOutput(
      '<function_calls>\n<invoke name="Bash">\n<parameter name="command">ls -la</parameter>\n</invoke>\n</function_calls>',
    )
    expect(r.toolCalls).toEqual([{ name: 'Bash', args: { command: 'ls -la' } }])
    expect(r.finalText).toBe('')
    expect(r.warnings).toEqual([])
  })

  test('並列複数 invoke(1ブロック内)', () => {
    const r = parseRawOutput(
      '<function_calls>\n' +
        '<invoke name="Read"><parameter name="path">a.ts</parameter></invoke>\n' +
        '<invoke name="Read"><parameter name="path">b.ts</parameter></invoke>\n' +
        '</function_calls>',
    )
    expect(r.toolCalls).toEqual([
      { name: 'Read', args: { path: 'a.ts' } },
      { name: 'Read', args: { path: 'b.ts' } },
    ])
    expect(r.warnings).toEqual([])
  })

  test('並列複数 invoke(ブロック分割)', () => {
    const r = parseRawOutput(
      '<function_calls><invoke name="A"><parameter name="x">1</parameter></invoke></function_calls>\n' +
        '<function_calls><invoke name="B"><parameter name="y">2</parameter></invoke></function_calls>',
    )
    expect(r.toolCalls.map((t) => t.name)).toEqual(['A', 'B'])
  })

  test('function_calls ラッパーなしの invoke も受け付ける', () => {
    const r = parseRawOutput('<invoke name="Bash"><parameter name="command">pwd</parameter></invoke>')
    expect(r.toolCalls).toEqual([{ name: 'Bash', args: { command: 'pwd' } }])
  })

  test('JSON ボディへのフォールバック', () => {
    const r = parseRawOutput('<invoke name="Bash">{"command": "echo hi", "timeout": 5}</invoke>')
    expect(r.toolCalls).toEqual([{ name: 'Bash', args: { command: 'echo hi', timeout: 5 } }])
    expect(r.warnings).toEqual([])
  })

  test('パースできないボディは警告して引数なし', () => {
    const r = parseRawOutput('<invoke name="Bash">ただのテキスト</invoke>')
    expect(r.toolCalls).toEqual([{ name: 'Bash', args: {} }])
    expect(r.warnings.length).toBe(1)
  })

  test('崩れた invoke タグは警告して本文扱い', () => {
    const r = parseRawOutput('<invoke name="Bash">閉じタグがない')
    expect(r.toolCalls).toEqual([])
    expect(r.finalText).toContain('<invoke')
    expect(r.warnings.some((w) => w.includes('invoke'))).toBe(true)
  })

  test('崩れた thinking タグは警告して本文扱い', () => {
    const r = parseRawOutput('<thinking>閉じ忘れ')
    expect(r.thoughts).toEqual([])
    expect(r.finalText).toContain('<thinking>')
    expect(r.warnings.some((w) => w.includes('thinking'))).toBe(true)
  })

  test('thinking + tool call + final の混在', () => {
    const r = parseRawOutput(
      '<thinking>調べる必要がある</thinking>\n' +
        '<function_calls><invoke name="Grep"><parameter name="pattern">foo</parameter></invoke></function_calls>\n' +
        '残りは本文',
    )
    expect(r.thoughts).toEqual(['調べる必要がある'])
    expect(r.toolCalls).toEqual([{ name: 'Grep', args: { pattern: 'foo' } }])
    expect(r.finalText).toBe('残りは本文')
  })

  test('parameter の値は複数行を保持する', () => {
    const r = parseRawOutput(
      '<invoke name="Write"><parameter name="content">line1\nline2\nline3</parameter></invoke>',
    )
    expect(r.toolCalls[0]?.args['content']).toBe('line1\nline2\nline3')
  })
})
