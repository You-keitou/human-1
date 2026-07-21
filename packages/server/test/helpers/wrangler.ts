// wrangler dev をヘッドレスで起動するためのヘルパ。
// CLAUDE.md「検証の作法」の人間シミュレータ方式に従い、実サーバー(Workers ランタイム)へ
// HTTP / WS で疎通する。AUTH_TOKEN は .dev.vars と同じ値を読み取って統一する。
//
// 既定インスタンス(startWrangler)はスイート全体で 1 回だけ共有する。
// タイムアウト検証など特殊な env が要る場合は startWranglerInstance で別ポートに立てる。

import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type Subprocess, spawn } from 'bun'

const serverDir = resolve(import.meta.dir, '..', '..')
const devVarsPath = resolve(serverDir, '.dev.vars')

export type ServerHandle = {
  baseUrl: string
  wsUrl: (token: string) => string
  token: string
  stop: () => Promise<void>
}

type LaunchConfig = {
  port: number
  inspectorPort: number
  // wrangler dev --var KEY:VALUE で注入する text バインディング。
  vars?: Record<string, string>
}

async function readAuthToken(): Promise<string> {
  try {
    const text = await Bun.file(devVarsPath).text()
    const m = text.match(/^AUTH_TOKEN=(.*)$/m)
    if (m?.[1]) return m[1].trim()
  } catch {
    // .dev.vars が無ければ既定値にフォールバック
  }
  return 'dev-secret-token'
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 指定ポートに独立インスタンスを立てる(別プロセス・別 DO 状態)。
export function startWranglerInstance(config: LaunchConfig): Promise<ServerHandle> {
  return launch(config)
}

async function launch(config: LaunchConfig): Promise<ServerHandle> {
  const { port, inspectorPort, vars } = config
  const token = await readAuthToken()
  const baseUrl = `http://127.0.0.1:${port}`
  // 起動ごとに新鮮な DO 永続先を使う(.wrangler は gitignore 済み)。ポート再利用の連続実行で
  // SQLite state を共有すると、終端イベント履歴の跨ぎ蓄積やロック競合で workerd が不安定化するため、
  // 各起動で隔離し stop() で破棄する。
  const persistDir = resolve(
    serverDir,
    '.wrangler',
    `test-state-${port}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )

  const varArgs = Object.entries(vars ?? {}).flatMap(([k, v]) => ['--var', `${k}:${v}`])
  const proc: Subprocess = spawn(
    [
      'bunx',
      'wrangler',
      'dev',
      '--port',
      String(port),
      '--inspector-port',
      String(inspectorPort),
      '--persist-to',
      persistDir,
      ...varArgs,
    ],
    {
      cwd: serverDir,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  )

  let exited = false
  proc.exited.then(() => {
    exited = true
  })

  // stderr を継続的に排出する。'pipe' のまま読まずに放置すると、長時間のスイート中に wrangler が
  // stderr を大量出力した際、OS のパイプバッファ(~64KB)が満杯になり write() がブロック → wrangler が
  // ハングして接続不能になる(bun のプロセス/stdio 挙動変化で顕在化しやすい)。末尾 8KB だけ診断用に保持。
  let stderrTail = ''
  const drainStderr = async () => {
    if (!proc.stderr) return
    try {
      const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        stderrTail = (stderrTail + dec.decode(value, { stream: true })).slice(-8192)
      }
    } catch {
      // 読めなくなったら諦める(プロセス終了時など)
    }
  }
  void drainStderr()

  const handle: ServerHandle = {
    baseUrl,
    token,
    wsUrl: (t: string) => `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(t)}`,
    stop: async () => {
      try {
        proc.kill()
      } catch {
        // 既に終了していれば無視
      }
      await proc.exited
      // 使い捨ての永続先を破棄(ディスクに溜めない)。
      await rm(persistDir, { recursive: true, force: true }).catch(() => {})
    },
  }

  // readiness: /v1/models が 200 を返すまでポーリング。最大 60s。
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (exited) {
      // 少し待って drain 済みの stderr 末尾を診断に添える。
      await sleep(50)
      throw new Error(`wrangler dev が起動前に終了しました:\n${stderrTail}`)
    }
    try {
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        await res.text()
        // cold-start 対策: 人間を介さず即応答される裏方リクエストで /v1/messages と
        // /v1/responses の DO 経路を温めておく(初回リクエストの 503 flake を排除)。
        if (await warmUp(baseUrl, token)) return handle
      }
    } catch {
      // まだ起動していない
    }
    await sleep(400)
  }

  await handle.stop()
  throw new Error('wrangler dev が 60s 以内に ready になりませんでした')
}

// 裏方リクエスト(title / rollout メモリ)は人間を介さずサーバーが即応答するので、
// warmup に使える。両プロトコルが 200 を返すまで温める。
async function warmUp(baseUrl: string, token: string): Promise<boolean> {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  const messagesWarm = fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'human',
      messages: [{ role: 'user', content: '<session>x</session>\nWrite the title' }],
      stream: false,
    }),
  })
  const responsesWarm = fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'human',
      input: 'Analyze this rollout and emit rollout_slug',
      stream: false,
    }),
  })
  try {
    const [m, r] = await Promise.all([messagesWarm, responsesWarm])
    await Promise.all([m.text(), r.text()])
    return m.ok && r.ok
  } catch {
    return false
  }
}
