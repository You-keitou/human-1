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
    const r = parseRawOutput(
      '<invoke name="Bash"><parameter name="command">pwd</parameter></invoke>',
    )
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
    expect(r.toolCalls[0]?.args.content).toBe('line1\nline2\nline3')
  })

  // ---- 回帰: トークナイザ化で修正した欠陥ケース ----

  test('未閉鎖 invoke A の後に完全な invoke B が続いても A に取り込まれない', () => {
    const r = parseRawOutput(
      '<invoke name="A"><invoke name="B"><parameter name="x">1</parameter></invoke>',
    )
    // 旧実装は A の開始と B の閉じをペアリングし、B のパラメータを持つ単一 A を生成していた。
    expect(r.toolCalls).toEqual([{ name: 'B', args: { x: '1' } }])
    expect(r.toolCalls.some((c) => c.name === 'A')).toBe(false)
    expect(r.finalText).toContain('<invoke name="A">')
    expect(r.warnings.some((w) => w.includes('invoke'))).toBe(true)
  })

  test('値内リテラル </parameter> は欠損せず警告される', () => {
    const r = parseRawOutput(
      '<invoke name="Write"><parameter name="content">a</parameter>b</parameter></invoke>',
    )
    // 旧実装は content="a" として b を無警告で消していた。
    expect(r.toolCalls[0]?.args.content).toBe('a</parameter>b')
    expect(r.toolCalls.length).toBe(1)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  test('隣接する不正 invoke: 構造未閉鎖の A は本文化し、後続の B のみ tool call 化', () => {
    const r = parseRawOutput(
      '<invoke name="A"><parameter name="x">oops</invoke>' +
        '<invoke name="B"><parameter name="y">2</parameter></invoke>',
    )
    // A の parameter x は </parameter> で閉じておらず構造的に壊れている → A 全体を本文へ戻す。
    // 走査境界を次の open invoke で打ち切るので B を飲み込まず、B は独立して正当に抽出される。
    expect(r.toolCalls).toEqual([{ name: 'B', args: { y: '2' } }])
    expect(r.toolCalls.some((c) => c.name === 'A')).toBe(false)
    // A の原文(値 oops も含む)は finalText に残り欠損しない。
    expect(r.finalText).toContain('<invoke name="A">')
    expect(r.finalText).toContain('oops')
    expect(r.warnings.some((w) => w.includes('invoke'))).toBe(true)
  })

  test('値内リテラル </invoke> でも args が空にならず警告される', () => {
    const r = parseRawOutput(
      '<invoke name="Bash"><parameter name="command">echo </invoke> hi</parameter></invoke>',
    )
    // 旧実装は args 空のまま tool call を生成していた。
    expect(r.toolCalls.length).toBe(1)
    expect(r.toolCalls[0]?.args.command).toBe('echo </invoke> hi')
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  test('有効パラメータの後に構造未閉鎖パラメータがあると invocation 全体を本文化(値は欠損しない)', () => {
    const r = parseRawOutput(
      '<invoke name="X"><parameter name="a">1</parameter><parameter name="b">oops</invoke>',
    )
    // b が </parameter> で閉じていない → X 全体を本文へ戻す(壊れた引数のツール実行を防ぐ)。
    expect(r.toolCalls).toEqual([])
    // a='1'・b='oops' の値は原文として finalText に保持され、無警告欠損しない。
    expect(r.finalText).toContain('<invoke name="X">')
    expect(r.finalText).toContain('oops')
    expect(r.finalText).toContain('>1<')
    expect(r.warnings.some((w) => w.includes('invoke'))).toBe(true)
  })

  test('開き先行: parameter 値内に開始 <invoke> が現れると A は本文化し B のみ抽出', () => {
    const r = parseRawOutput(
      '<invoke name="A"><parameter name="x">oops<invoke name="B"><parameter name="y">2</parameter></invoke>',
    )
    // 旧実装は開き <invoke> を値テキストとして素通りし、B を x に埋め込んで実行可能な A を生成していた。
    expect(r.toolCalls).toEqual([{ name: 'B', args: { y: '2' } }])
    expect(r.toolCalls.some((c) => c.name === 'A')).toBe(false)
    expect(r.finalText).toContain('<invoke name="A">')
    expect(r.finalText).toContain('oops')
    expect(r.warnings.some((w) => w.includes('invoke'))).toBe(true)
  })

  test('三重ネスト: 最内の完全な invocation のみ抽出し、外側は本文+警告(欠損ゼロ)', () => {
    const r = parseRawOutput(
      '<invoke name="A"><parameter name="x"><invoke name="B"><parameter name="y">' +
        '<invoke name="C"><parameter name="z">1</parameter></invoke>',
    )
    expect(r.toolCalls).toEqual([{ name: 'C', args: { z: '1' } }])
    expect(r.finalText).toContain('<invoke name="A">')
    expect(r.finalText).toContain('<invoke name="B">')
    expect(r.warnings.some((w) => w.includes('invoke'))).toBe(true)
  })

  test('1つの parameter 値内に複数の開始 <invoke>: 後続の完全な invocation を抽出し原文保持', () => {
    const r = parseRawOutput(
      '<invoke name="A"><parameter name="x">a<invoke name="B">b' +
        '<invoke name="C"><parameter name="z">1</parameter></invoke>',
    )
    expect(r.toolCalls).toEqual([{ name: 'C', args: { z: '1' } }])
    expect(r.finalText).toContain('<invoke name="A">')
    expect(r.finalText).toContain('a')
    expect(r.finalText).toContain('<invoke name="B">')
    expect(r.finalText).toContain('b')
    expect(r.warnings.some((w) => w.includes('invoke'))).toBe(true)
  })

  test('値内リテラルで最終的に構造が閉じている parameter は正当な tool call のまま維持', () => {
    // </parameter> / </invoke> をリテラル値に含んでも、最後に構造として閉じていれば tool call。
    const r = parseRawOutput(
      '<invoke name="Write"><parameter name="content">a</parameter>b</parameter></invoke>' +
        '<invoke name="Bash"><parameter name="command">echo </invoke> hi</parameter></invoke>',
    )
    expect(r.toolCalls).toEqual([
      { name: 'Write', args: { content: 'a</parameter>b' } },
      { name: 'Bash', args: { command: 'echo </invoke> hi' } },
    ])
    // 本文化はされない(壊れているのは「構造未閉鎖」だけ)。
    expect(r.finalText).toBe('')
    // 曖昧警告は出るが、tool call は維持される。
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  test('ミスマッチ <thinking>…</think> は無警告受理しない', () => {
    const r = parseRawOutput('<thinking>考え中</think>')
    expect(r.thoughts).toEqual([])
    expect(r.finalText).toContain('<thinking>')
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  test('単引用の name 属性を受け付ける', () => {
    const r = parseRawOutput(
      "<invoke name='Bash'><parameter name='command'>pwd</parameter></invoke>",
    )
    expect(r.toolCalls).toEqual([{ name: 'Bash', args: { command: 'pwd' } }])
    expect(r.warnings).toEqual([])
  })

  test('invoke の追加属性は無視して name を拾う', () => {
    const r = parseRawOutput(
      '<invoke name="Bash" id="1"><parameter name="command">ls</parameter></invoke>',
    )
    expect(r.toolCalls).toEqual([{ name: 'Bash', args: { command: 'ls' } }])
    expect(r.warnings).toEqual([])
  })

  test('属性付き thinking も thinking として受理する', () => {
    const r = parseRawOutput('<thinking signature="abc">熟考</thinking>結論')
    expect(r.thoughts).toEqual(['熟考'])
    expect(r.finalText).toBe('結論')
    expect(r.warnings).toEqual([])
  })
})
