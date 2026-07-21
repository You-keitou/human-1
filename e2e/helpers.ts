import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'

// e2e 共通ヘルパ(Playwright = node ランタイムで動くため、bun 専用ヘルパは使わない)。
// - 実サーバー(wrangler dev :8791)へは Playwright 側(node)から直接 fetch する。
// - ブラウザ側は vite の /v1・/api・/ws プロキシ経由で同一オリジンとして叩く。

export const API_PORT = 8791
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`
export const WS_TOKEN_KEY = 'human-1-token'

// .dev.vars の AUTH_TOKEN を読む(無ければ既定値)。
export function authToken(): string {
  try {
    const text = readFileSync(resolve(process.cwd(), 'packages/server/.dev.vars'), 'utf8')
    const m = text.match(/^AUTH_TOKEN=(.*)$/m)
    if (m?.[1]) return m[1].trim()
  } catch {
    // .dev.vars が無ければ既定値へフォールバック
  }
  return 'dev-secret-token'
}

const bearer = (token: string): Record<string, string> => ({
  'content-type': 'application/json',
  authorization: `Bearer ${token}`,
})

export function apiFetch(path: string, init: RequestInit, token: string): Promise<Response> {
  return fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers: { ...bearer(token), ...(init.headers as Record<string, string> | undefined) },
  })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// wrangler dev の起動直後は isolate リロードで一時的に 503 を返す。裏方リクエスト
// (人間を介さず即応答される)を両プロトコルで叩いて 200 になるまで温める。
export async function warmup(token: string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const [m, r] = await Promise.all([
        apiFetch(
          '/v1/messages',
          {
            method: 'POST',
            body: JSON.stringify({
              model: 'human',
              messages: [{ role: 'user', content: '<session>x</session>\nWrite the title' }],
              stream: false,
            }),
          },
          token,
        ),
        apiFetch(
          '/v1/responses',
          {
            method: 'POST',
            body: JSON.stringify({
              model: 'human',
              input: 'Analyze this rollout and emit rollout_slug',
              stream: false,
            }),
          },
          token,
        ),
      ])
      const ok = m.status === 200 && r.status === 200
      await Promise.all([m.text(), r.text()])
      if (ok) return
    } catch {
      // まだ起動していない
    }
    await sleep(300)
  }
  throw new Error('wrangler dev が warmup 期限内に ready になりませんでした')
}

// codex 相当の非ストリーム /v1/responses を発行し、レスポンス Promise を返す(await しない)。
// 人間(= ブラウザ UI)が回答するまで解決しない。
export function postResponses(body: Record<string, unknown>, token: string): Promise<Response> {
  return apiFetch('/v1/responses', { method: 'POST', body: JSON.stringify(body) }, token)
}

export type RunSeed = { runId: string; rolloutId: string }

// /runs 表示用に run → rollout → [SCORE] 採点を API で仕込む。
export async function seedScoredRun(
  title: string,
  scoreText: string,
  token: string,
): Promise<RunSeed> {
  const runRes = await apiFetch(
    '/api/runs',
    { method: 'POST', body: JSON.stringify({ title }) },
    token,
  )
  const runId = ((await runRes.json()) as { run: { id: string } }).run.id
  const rolloutRes = await apiFetch(
    `/api/runs/${runId}/rollouts`,
    { method: 'POST', body: JSON.stringify({ task: 'e2e task' }) },
    token,
  )
  const rolloutId = ((await rolloutRes.json()) as { rollout: { id: string } }).rollout.id
  await apiFetch(
    `/api/rollouts/${rolloutId}/score`,
    { method: 'POST', body: JSON.stringify({ text: scoreText }) },
    token,
  )
  return { runId, rolloutId }
}

// トークンを localStorage に仕込み、TokenGate を素通りさせる。
export async function primeToken(page: Page, token: string): Promise<void> {
  await page.addInitScript(
    ([key, tok]) => {
      window.localStorage.setItem(key, tok)
    },
    [WS_TOKEN_KEY, token] as const,
  )
}

export async function captureSockets(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Orig = window.WebSocket
    const list: WebSocket[] = []
    ;(window as unknown as { __wsList: WebSocket[] }).__wsList = list
    window.WebSocket = new Proxy(Orig, {
      construct(target, args: [string | URL, (string | string[])?]) {
        const ws = new target(...args)
        list.push(ws)
        return ws
      },
    })
  })
}

// アプリの WS(/ws)を落として再接続を誘発する。vite プロキシ越しだと ws.close() の
// クローズハンドシェイクが CLOSING で止まり onclose が発火しない(= 再接続しない)ため、
// 合成 close イベントを dispatch してアプリの onclose ハンドラを確実に叩く。
export async function closeAppSocket(page: Page): Promise<number> {
  return page.evaluate(() => {
    const list = (window as unknown as { __wsList?: WebSocket[] }).__wsList ?? []
    let n = 0
    for (const ws of list) {
      if (String(ws.url).includes('/ws') && ws.readyState <= 1) {
        try {
          ws.close()
        } catch {
          // 無視
        }
        ws.dispatchEvent(new CloseEvent('close'))
        n++
      }
    }
    return n
  })
}

// これまでに生成された WS 総数(再接続で増える)。captureSockets 前提。
export function socketCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __wsList?: WebSocket[] }).__wsList?.length ?? 0,
  )
}

// 再接続(新規 WS 生成)を待つ。offline/connecting のテキスト窓は短いので、socket 生成の
// 増加を頑健なシグナルにする。
export async function waitForReconnect(
  page: Page,
  prev: number,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await socketCount(page)) > prev) return
    await sleep(150)
  }
  throw new Error(`再接続(新規 WS)が ${timeoutMs}ms 以内に発生しませんでした`)
}

// エディタへ合成 keydown(Cmd+Enter)を送る。composing=true で IME 変換中を模す
// (isComposing / keyCode 229)。ProseMirror の keydown リスナに直接届く。
export async function dispatchCmdEnter(page: Page, opts: { composing: boolean }): Promise<void> {
  await page.evaluate((composing) => {
    const el = document.querySelector('.rich-editor-content') as HTMLElement | null
    if (!el) throw new Error('.rich-editor-content が見つかりません')
    el.focus()
    const ev = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: composing ? 229 : 13,
      metaKey: true,
      ctrlKey: true,
      isComposing: composing,
      bubbles: true,
      cancelable: true,
    })
    el.dispatchEvent(ev)
  }, opts.composing)
}

// 表示中の pending をすべて UI から回答して掃き出す(直列テスト間の DO 状態を汚さない)。
// 既存下書き(スラッシュコマンド途中等)を消してから普通の本文を送るので、誤送信ガードを踏まない。
export async function drainPending(page: Page): Promise<void> {
  const editor = page.locator('.rich-editor-content')
  for (let i = 0; i < 6; i++) {
    const chips = page.locator('button[aria-pressed]')
    if ((await chips.count()) === 0) return
    await chips.first().click()
    await editor.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await page.keyboard.insertText(`drain ${i}`)
    await page.getByRole('button', { name: '送信', exact: true }).click()
    await sleep(250)
  }
}

// エディタ(tiptap contenteditable)へ Claude 方言の raw テキストを一括投入する。
// insertText(一括)なので `<thinking>` の input rule(先頭・単一空白で発火)は起きず、
// serialize() は素の本文として直列化し、shared parseRawOutput がタグを解釈する。
export async function typeDialect(page: Page, raw: string): Promise<void> {
  const editor = page.locator('.rich-editor-content')
  await editor.click()
  await page.keyboard.insertText(raw)
}
