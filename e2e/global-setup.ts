import { type ChildProcess, execSync, spawn } from 'node:child_process'
import { mkdirSync, openSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { API_ORIGIN, API_PORT } from './helpers'

// e2e 実行前に実サーバー(wrangler dev :8791)を自前で起動する。
// Playwright の webServer で wrangler を管理させると(TTY 無し spawn 下で)公開ポートを
// bind できずハングするため、globalSetup で node child_process から起動し、readiness を
// ポーリングしてから返す。返り値の teardown で終了時にプロセスグループごと停止する。
//
// あわせて:前回残りが 8791 を掴んでいたら解放し、DO 永続状態を消して毎回クリーンにする
// (×3 反復の決定性)。vite(:5199)は Playwright の webServer 側で起動する。

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export default async function globalSetup(): Promise<() => Promise<void>> {
  // 1) 前回残りの wrangler/workerd を解放(空なら何もしない)。
  try {
    execSync(`pids=$(lsof -ti tcp:${API_PORT}); [ -n "$pids" ] && kill -9 $pids || true`, {
      stdio: 'ignore',
      shell: '/bin/sh',
    })
  } catch {
    // 掴んでいるプロセスが無ければ無視
  }
  // 2) DO 永続状態を消す(毎回まっさらな run / pending から始める)。
  rmSync(resolve(process.cwd(), 'packages/server/.wrangler/e2e-state'), {
    recursive: true,
    force: true,
  })
  await sleep(300)

  // 3) wrangler dev を起動(detached: プロセスグループ単位で kill できるように)。
  mkdirSync(resolve(process.cwd(), 'artifacts'), { recursive: true })
  const logFd = openSync(resolve(process.cwd(), 'artifacts/e2e-wrangler.log'), 'w')
  const child: ChildProcess = spawn(
    'bunx',
    [
      'wrangler',
      'dev',
      '--port',
      String(API_PORT),
      '--inspector-port',
      '9791',
      '--persist-to',
      '.wrangler/e2e-state',
    ],
    {
      cwd: resolve(process.cwd(), 'packages/server'),
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
      stdio: ['ignore', logFd, logFd],
      detached: true,
    },
  )
  child.unref()

  // 4) readiness: / が 200 を返すまでポーリング(SPA フォールバックで認証不要 200)。
  const deadline = Date.now() + 60_000
  let ready = false
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_ORIGIN}/`)
      const ok = res.ok
      await res.text()
      if (ok) {
        ready = true
        break
      }
    } catch {
      // まだ起動していない
    }
    await sleep(400)
  }
  if (!ready) throw new Error('e2e: wrangler dev が 60s 以内に ready になりませんでした')

  // teardown: プロセスグループごと停止する。
  return async () => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL')
    } catch {
      // 既に停止していれば無視
    }
  }
}
