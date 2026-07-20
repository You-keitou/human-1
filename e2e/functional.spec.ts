import { expect, test } from '@playwright/test'
import {
  authToken,
  captureSockets,
  dropSockets,
  postResponses,
  primeToken,
  seedScoredRun,
  typeDialect,
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
  await page.getByRole('button', { name: '送信' }).click()

  // SSE(非ストリーム JSON)に function_call が 2 個。
  const output = await outputOf(await p)
  const fnCalls = output.filter((o) => o.type === 'function_call')
  expect(fnCalls).toHaveLength(2)
  expect(fnCalls.map((o) => o.name).sort()).toEqual(['Grep', 'Read'])

  // 履歴に tools 表示。
  await expect(page.getByText('tools', { exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: '送信' }).click()

  const output = await outputOf(await p)
  expect(output.some((o) => o.type === 'message')).toBe(true)
  expect(JSON.stringify(output)).toContain(finalText)

  await expect(page.getByText('answered', { exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: '送信' }).click()

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
  await page.getByRole('button', { name: '送信' }).click()

  // tool 優先の警告。
  await expect(page.locator('.parse-warning').filter({ hasText: 'tool call' })).toBeVisible()
  // 実挙動: tool を提出(function_call が返り、本文は破棄)。
  const output = await outputOf(await p)
  expect(output.filter((o) => o.type === 'function_call')).toHaveLength(1)
  expect(JSON.stringify(output)).not.toContain('同時に書いた本文')
  await expect(page.getByText('tools', { exact: true })).toBeVisible()
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

  // WS を強制切断 → 再接続でサーバーが pending snapshot を再送 → store が requestId で重複排除。
  await dropSockets(page)
  await expect(page.getByText(/offline|connecting/)).toBeVisible({ timeout: 10_000 })
  await liveStatus(page)

  // 再接続後も request は 1 件のまま(重複していない)。
  await expect(page.locator('button[aria-pressed]')).toHaveCount(1)
  await expect(page.getByText(nonce, { exact: false })).toHaveCount(1)

  // 後片付け: 回答して pending を解消する。
  await typeDialect(page, `片付け ${nonce}`)
  await page.getByRole('button', { name: '送信' }).click()
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

// ---------- 9. モバイル幅(390px)でワークスペースが折りたたまれる ----------

test('モバイル幅(390px)でワークスペース本体が縦積みに折りたたまれる', async ({ page }) => {
  await primeToken(page, token)
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/')
  await liveStatus(page)

  const editorBox = await page.locator('.rich-editor-root').boundingBox()
  const reqBox = await page.getByText(/REQUESTS ·/).boundingBox()
  expect(editorBox).not.toBeNull()
  expect(reqBox).not.toBeNull()
  // モバイル(縦積み): エディタは左端付近・リクエスト列より下に来る(row の右列ではない)。
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
