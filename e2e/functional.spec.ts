import { expect, test } from '@playwright/test'
import {
  authToken,
  captureSockets,
  closeAppSocket,
  dispatchCmdEnter,
  drainPending,
  postResponses,
  primeToken,
  seedScoredRun,
  socketCount,
  typeDialect,
  waitForReconnect,
  warmup,
} from './helpers'

// M3 第 2 段(UI 機能配線)の実機能 e2e。実 wrangler dev(webServer)+ 実 vite プロキシで
// 実 WS / REST を通し、仕様から導出したシナリオを検証する。共有 DO('main')を使うため直列実行。
// 実装バグは曲げず、失敗テスト+切り分けとして残す。

test.describe.configure({ mode: 'serial' })

const token = authToken()
let nonceSeq = 0
const nextNonce = (): string => `e2e-${Date.now()}-${nonceSeq++}`

type OutItem = { type: string; name?: string; content?: { text?: string }[] }
async function outputOf(resp: Response): Promise<OutItem[]> {
  const body = (await resp.json()) as { output?: OutItem[] }
  return body.output ?? []
}

const liveStatus = (page: import('@playwright/test').Page) =>
  expect(page.getByText('live', { exact: true })).toBeVisible({ timeout: 20_000 })

test.beforeAll(async () => {
  await warmup(token)
})

// ---------- 1. トークンゲート ----------

test('未設定ならゲート、正トークンで WS live、誤トークンは接続失敗が可視化される', async ({
  page,
}) => {
  // 1a: トークン未設定 → ゲート表示。
  await page.goto('/')
  await expect(page.getByLabel('アクセストークン')).toBeVisible()
  await expect(page.getByRole('button', { name: '接続' })).toBeVisible()

  // 1b: 正トークン入力 → ワークスペース + WS live。
  await page.getByLabel('アクセストークン').fill(token)
  await page.getByRole('button', { name: '接続' }).click()
  await expect(page.getByRole('button', { name: '接続' })).toHaveCount(0)
  await liveStatus(page)
})

test('誤トークンは live にならず offline/connecting が可視化される', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('アクセストークン').fill('wrong-token')
  await page.getByRole('button', { name: '接続' }).click()
  // ゲートは通過(トークンは検証せず保存)するが、WS は確立せず live にならない。
  await expect(page.getByText('live', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/offline|connecting/)).toBeVisible({ timeout: 15_000 })
})

// ---------- 2. codex 相当の request → thinking + 並列 tool call(2) → SSE function_call×2 ----------

test('codex /v1/responses が UI に現れ、thinking+並列 tool call を送ると function_call が 2 個返る', async ({
  page,
}) => {
  const nonce = nextNonce()
  await primeToken(page, token)
  await page.goto('/')
  await liveStatus(page)

  const p = postResponses(
    {
      model: 'human',
      input: `${nonce} 2 つ読んで`,
      tools: [
        { type: 'function', name: 'Read' },
        { type: 'function', name: 'Grep' },
      ],
      stream: false,
    },
    token,
  )

  // request が UI に到達(内容に nonce)。
  await expect(page.getByText(nonce, { exact: false })).toBeVisible({ timeout: 15_000 })

  await typeDialect(
    page,
    `<thinking>${nonce} を読む計画</thinking>` +
      `<function_calls><invoke name="Read"><parameter name="path">a.txt</parameter></invoke></function_calls>` +
      `<function_calls><invoke name="Grep"><parameter name="pattern">x</parameter></invoke></function_calls>`,
  )
  await page.getByRole('button', { name: '送信', exact: true }).click()

  // SSE(非ストリーム JSON)に function_call が 2 個。
  const output = await outputOf(await p)
  const fnCalls = output.filter((o) => o.type === 'function_call')
  expect(fnCalls).toHaveLength(2)
  expect(fnCalls.map((o) => o.name).sort()).toEqual(['Grep', 'Read'])

  // tool 提出でターンが終端し、pending が消費される(旧 History 'tools' ラベルの代替検証)。
  await expect(page.getByText(/会話 · pending 0/)).toBeVisible()
})

// ---------- 3. 継続(tool 結果込み)→ thinking + final → answered ----------

test('tool 結果込みの継続リクエストに thinking+final を返すと answered になる', async ({
  page,
}) => {
  const nonce = nextNonce()
  const resultMark = `result-${nonce}`
  await primeToken(page, token)
  await page.goto('/')
  await liveStatus(page)

  const p = postResponses(
    {
      model: 'human',
      input: [
        { role: 'user', content: `${nonce} 続きを頼む` },
        { type: 'function_call', name: 'Read', arguments: '{}' },
        { type: 'function_call_output', output: `ファイル内容 ${resultMark}` },
      ],
      stream: false,
    },
    token,
  )

  // tool 結果が request に含まれて表示される。
  await expect(page.getByText('[function_call_output]', { exact: false })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText(resultMark, { exact: false })).toBeVisible()

  const finalText = `最終回答 ${nonce}`
  await typeDialect(page, `<thinking>結果を確認した</thinking>${finalText}`)
  await page.getByRole('button', { name: '送信', exact: true }).click()

  const output = await outputOf(await p)
  expect(output.some((o) => o.type === 'message')).toBe(true)
  expect(JSON.stringify(output)).toContain(finalText)

  // final 提出でターンが終端し pending が消費される(旧 History 'answered' ラベルは廃止。
  // LiveHeader の "answered" カウンタ表記と衝突しない pending 消費で検証する)。
  await expect(page.getByText(/会話 · pending 0/)).toBeVisible()
})

// ---------- 4. パーサ警告(崩れタグ)----------

test('崩れタグ(未閉鎖 thinking)は警告が出て本文扱いになる', async ({ page }) => {
  const nonce = nextNonce()
  await primeToken(page, token)
  await page.goto('/')
  await liveStatus(page)

  const p = postResponses({ model: 'human', input: `${nonce} 崩れタグ`, stream: false }, token)
  await expect(page.getByText(nonce, { exact: false })).toBeVisible({ timeout: 15_000 })

  await typeDialect(page, `<thinking>閉じ忘れた思考 ${nonce}`)
  await page.getByRole('button', { name: '送信', exact: true }).click()

  // UI にパーサ警告が表示される。
  await expect(page.locator('.parse-warning').filter({ hasText: '未閉鎖' })).toBeVisible()
  // 崩れタグは本文として送信され answered になる(データ欠損しない)。
  const output = await outputOf(await p)
  expect(JSON.stringify(output)).toContain('閉じ忘れた思考')
})

// ---------- 5. tool call + final 同時 → tool 優先 + 警告 ----------

test('tool call と final を同時入力すると tool を優先し警告を出す', async ({ page }) => {
  const nonce = nextNonce()
  await primeToken(page, token)
  await page.goto('/')
  await liveStatus(page)

  const p = postResponses({ model: 'human', input: `${nonce} 同時入力`, stream: false }, token)
  await expect(page.getByText(nonce, { exact: false })).toBeVisible({ timeout: 15_000 })

  await typeDialect(
    page,
    `<function_calls><invoke name="Read"><parameter name="path">a</parameter></invoke></function_calls>` +
      `これは同時に書いた本文 ${nonce}`,
  )
  await page.getByRole('button', { name: '送信', exact: true }).click()

  // tool 優先の警告。
  await expect(page.locator('.parse-warning').filter({ hasText: 'tool call' })).toBeVisible()
  // 実挙動: tool を提出(function_call が返り、本文は破棄)。
  const output = await outputOf(await p)
  expect(output.filter((o) => o.type === 'function_call')).toHaveLength(1)
  expect(JSON.stringify(output)).not.toContain('同時に書いた本文')
  // tool 提出でターンが終端し pending が消費される(旧 History 'tools' ラベルの代替検証)。
  await expect(page.getByText(/会話 · pending 0/)).toBeVisible()
})

// ---------- 6. WS 切断 → 再接続で pending snapshot が重複しない ----------

test('WS 切断 → 再接続で pending request が重複せず 1 件のまま', async ({ page }) => {
  const nonce = nextNonce()
  await captureSockets(page)
  await primeToken(page, token)
  await page.goto('/')
  await liveStatus(page)

  // 回答しない pending を 1 件作る。
  const p = postResponses({ model: 'human', input: `${nonce} 保留`, stream: false }, token)
  await expect(page.getByText(nonce, { exact: false })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('button[aria-pressed]')).toHaveCount(1)

  // アプリの WS を落として再接続を誘発する(合成 close で onclose を確実に叩く)。
  // 再接続でサーバーが pending snapshot を再送 → store が requestId で重複排除する。
  const before = await socketCount(page)
  await closeAppSocket(page)
  await waitForReconnect(page, before)
  await liveStatus(page)

  // 再接続後も request は 1 件のまま(重複していない)。
  await expect(page.locator('button[aria-pressed]')).toHaveCount(1)
  await expect(page.getByText(nonce, { exact: false })).toHaveCount(1)

  // 後片付け: 回答して pending を解消する。
  await typeDialect(page, `片付け ${nonce}`)
  await page.getByRole('button', { name: '送信', exact: true }).click()
  await p.then((r) => r.text())
})

// ---------- 7. whiteboard → Mermaid 変換(graph / er / class)→ エディタ挿入 ----------

test('whiteboard: ノード追加 → Mermaid 変換(graph/er/class)がエディタへ挿入される', async ({
  page,
}) => {
  await primeToken(page, token)
  await page.goto('/whiteboard')
  // whiteboard タブがアクティブ。
  await expect(page.getByRole('tab', { name: 'Whiteboard' })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  const editor = page.locator('.rich-editor-content')
  const modeSelect = page.locator('select')
  const insertBtn = page.getByRole('button', { name: 'Mermaid として挿入 →' })
  const goWhiteboard = () => page.getByRole('tab', { name: 'Whiteboard' }).click()

  // ノード追加(サービス)→ graph 挿入。新ノード(Service)とシード(API Gateway)が出る。
  await page.getByRole('button', { name: '+ サービス' }).click()
  await modeSelect.selectOption('graph')
  await insertBtn.click()
  await expect(editor).toContainText('graph TD')
  await expect(editor).toContainText('```mermaid')
  await expect(editor).toContainText('API Gateway')
  await expect(editor).toContainText('Service')

  // er 挿入 → erDiagram + シード ER(orders → ORDERS)。
  await goWhiteboard()
  await modeSelect.selectOption('er')
  await insertBtn.click()
  await expect(editor).toContainText('erDiagram')
  await expect(editor).toContainText('ORDERS')

  // class 挿入 → classDiagram + シード class(OrderSaga)。
  await goWhiteboard()
  await modeSelect.selectOption('class')
  await insertBtn.click()
  await expect(editor).toContainText('classDiagram')
  await expect(editor).toContainText('OrderSaga')
})

// ---------- 8. /runs 実 API データ ----------

test('/runs が実 API の run/rollout/score を学習曲線・スコア付きで表示する', async ({ page }) => {
  const nonce = nextNonce()
  const title = `e2e run ${nonce}`
  await seedScoredRun(title, `よい設計だ [SCORE: 7.5/10]`, token)

  await primeToken(page, token)
  await page.goto('/runs')

  // 一覧に run タイトル(一覧 + 詳細で 2 箇所に出るため first を見る)。
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  // 詳細に採点([SCORE: 7.5/10])とスコア値。
  await expect(page.getByText('[SCORE: 7.5/10]', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('7.5', { exact: false }).first()).toBeVisible()
})

// ---------- 10. テーマ切替(system/light/dark)+ 永続 + FOUC なし ----------

test('テーマ切替: 3 値で data-theme が変わり、リロード後も保持される(FOUC なし)', async ({
  page,
}) => {
  await primeToken(page, token)
  await page.goto('/')
  await liveStatus(page)
  const html = page.locator('html')

  // 既定(system): data-theme 属性なし(prefers-color-scheme に委譲)。
  expect(await html.getAttribute('data-theme')).toBeNull()

  // dark → data-theme="dark" + aria-checked。
  await page.getByRole('radio', { name: 'ダークモード' }).click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('radio', { name: 'ダークモード' })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  // light → data-theme="light"。
  await page.getByRole('radio', { name: 'ライトモード' }).click()
  await expect(html).toHaveAttribute('data-theme', 'light')

  // system → 属性除去。
  await page.getByRole('radio', { name: 'システム設定に合わせる' }).click()
  expect(await html.getAttribute('data-theme')).toBeNull()

  // dark にしてリロード → 保持 + FOUC なし(head スクリプトが load 時点で適用済み)。
  await page.getByRole('radio', { name: 'ダークモード' }).click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  // リロード直後(React マウント前でも)既に dark が当たっている = FOUC なし。
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await liveStatus(page)
  await expect(page.getByRole('radio', { name: 'ダークモード' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})

// ---------- 11. スラッシュメニュー: 一致 0 件で「該当コマンドなし」 ----------

test('スラッシュメニュー: 一致 0 件で「該当コマンドなし」を表示する', async ({ page }) => {
  const nonce = nextNonce()
  await primeToken(page, token)
  await page.goto('/')
  await liveStatus(page)

  const p = postResponses({ model: 'human', input: `${nonce} slash`, stream: false }, token)
  await expect(page.getByText(nonce, { exact: false })).toBeVisible({ timeout: 15_000 })

  // 一致しないクエリでメニューを開く(char 送出で Suggestion を確実に発火させる)。
  await page.locator('.rich-editor-content').click()
  await page.keyboard.type('/zzzznope')
  await expect(page.locator('.slash-empty')).toHaveText(/該当コマンドなし/, { timeout: 5_000 })

  await page.keyboard.press('Escape')
  await drainPending(page)
  await p.then((r) => r.text())
})

// ---------- 12. 「/ex」誤送信ガード ----------

test('「/ex」誤送信ガード: 送信ブロック + banner。「本文として送信」で強行できる', async ({
  page,
}) => {
  const nonce = nextNonce()
  await primeToken(page, token)
  await page.goto('/')
  await liveStatus(page)

  const p = postResponses({ model: 'human', input: `${nonce} misfire`, stream: false }, token)
  await expect(page.getByText(nonce, { exact: false })).toBeVisible({ timeout: 15_000 })

  await page.locator('.rich-editor-content').click()
  await page.keyboard.type('/ex')
  await page.keyboard.press('Escape') // スラッシュメニューを閉じる(テキスト「/ex」は残る)
  await page.getByRole('button', { name: '送信', exact: true }).click()

  // 送信はブロックされ misfire banner が出る。
  await expect(page.locator('.misfire-banner')).toBeVisible()
  await expect(page.getByText('送信を止めました')).toBeVisible()
  // まだ送信されていない(pending 継続)。
  await expect(page.getByText(/会話 · pending 1/)).toBeVisible()

  // 「本文として送信」で強行 → final として送信される。
  await page.getByRole('button', { name: '本文として送信' }).click()
  const output = await outputOf(await p)
  expect(JSON.stringify(output)).toContain('/ex')
})

// ---------- 13. IME: 変換中の Cmd+Enter は送信されない ----------

test('IME 変換中の Cmd+Enter は送信されない(合成イベントで検証)', async ({ page }) => {
  const nonce = nextNonce()
  await primeToken(page, token)
  await page.goto('/')
  await liveStatus(page)

  const p = postResponses({ model: 'human', input: `${nonce} ime`, stream: false }, token)
  await expect(page.getByText(nonce, { exact: false })).toBeVisible({ timeout: 15_000 })

  await typeDialect(page, `IME最終回答 ${nonce}`)

  // 変換中(isComposing / keyCode 229)の Cmd+Enter → 送信されない。
  await dispatchCmdEnter(page, { composing: true })
  await page.waitForTimeout(600)
  await expect(page.getByText(/会話 · pending 1/)).toBeVisible()

  // 変換確定後(非 composing)の同じ合成 Cmd+Enter → 送信される
  // (= 合成イベントは PM に届いており、ブロックは composing 限定であることの対照確認)。
  await dispatchCmdEnter(page, { composing: false })
  const output = await outputOf(await p)
  expect(JSON.stringify(output)).toContain('IME最終回答')
})

// ---------- 14. 新左パネル: TRAINER 出題の大表示 + pending チップ切替 ----------

test('左パネル: TRAINER 出題が「出題」チップ付きで表示され、複数 pending のチップ切替が機能する', async ({
  page,
}) => {
  const a = nextNonce()
  const b = nextNonce()
  await primeToken(page, token)
  await page.goto('/')
  await liveStatus(page)

  const pa = postResponses({ model: 'human', input: `課題A ${a} を解いて`, stream: false }, token)
  const pb = postResponses({ model: 'human', input: `課題B ${b} を解いて`, stream: false }, token)

  // 2 件 pending・チップ 2 個。
  await expect(page.getByText(/会話 · pending 2/)).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('button[aria-pressed]')).toHaveCount(2)

  // 選択中(最初)の出題が TRAINER + 「出題」チップ付きで表示される。
  await expect(page.getByText('TRAINER').first()).toBeVisible()
  await expect(page.getByText('出題', { exact: true })).toBeVisible()
  await expect(page.getByText(a, { exact: false })).toBeVisible()

  // チップ #2 に切替 → 課題B が表示、課題A は消える(aria-pressed 維持)。
  await page.getByRole('button', { name: '#2 · responses' }).click()
  await expect(page.getByText(b, { exact: false })).toBeVisible()
  await expect(page.getByText(a, { exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '#2 · responses' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // thinking のみ送信 → request は pending のまま「thinking · 送信済み」echo が残る。
  await typeDialect(page, `<thinking>echo確認 ${b}</thinking>`)
  await page.getByRole('button', { name: '送信', exact: true }).click()
  await expect(page.getByText('thinking · 送信済み')).toBeVisible()

  // 後片付け。
  await drainPending(page)
  await Promise.all([pa.then((r) => r.text()), pb.then((r) => r.text())])
})

// ---------- 9. モバイル幅(390px)でワークスペースが折りたたまれる ----------

test('モバイル幅(390px)でワークスペース本体が縦積みに折りたたまれる', async ({ page }) => {
  await primeToken(page, token)
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/')
  await liveStatus(page)

  const editorBox = await page.locator('.rich-editor-root').boundingBox()
  // 左パネル刷新: 旧 "REQUESTS ·" → 会話パネル上部の "会話 · pending" 行をアンカーにする。
  const reqBox = await page.getByText(/会話 · pending/).boundingBox()
  expect(editorBox).not.toBeNull()
  expect(reqBox).not.toBeNull()
  // モバイル(縦積み): エディタは左端付近・会話パネルより下に来る(row の右列ではない)。
  expect((editorBox?.x ?? 999) < 120).toBe(true)
  expect((editorBox?.y ?? 0) > (reqBox?.y ?? 0)).toBe(true)
})

// LiveHeader がモバイル幅に適応せず ~711px に張り出して横スクロールを生むバグの回帰ガード。
// (検出時は失敗テストとして残置 → LiveHeader の useIsMobile 分岐で修正済み)
test('モバイル幅(390px)で横スクロールが発生しない', async ({ page }) => {
  await primeToken(page, token)
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/')
  await liveStatus(page)

  const diag = await page.evaluate(() => {
    let worst = { tag: '', text: '', right: 0 }
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.right > worst.right) {
        worst = {
          tag: el.tagName,
          text: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 40),
          right: Math.round(r.right),
        }
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      worst,
    }
  })
  expect(
    diag.scrollWidth,
    `横スクロールが発生(scrollWidth=${diag.scrollWidth} > innerWidth=${diag.innerWidth})。` +
      `最も張り出す要素: ${JSON.stringify(diag.worst)} — LiveHeader がモバイルで折り返さないのが原因。`,
  ).toBeLessThanOrEqual(diag.innerWidth + 2)
})
