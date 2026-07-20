// CLI × 実サーバー統合テスト(login / runs API クライアント / Observer / theater)。
// wrangler dev を専用ポート(8789)に 1 インスタンス立てて共有する(server テストの 8799/8798 と非衝突)。
// 仕様(CLAUDE.md / API 互換)から導出。実装のバグはテストを曲げず失敗のまま残す。

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HumanSim } from '../../server/test/helpers/humansim'
import { type ServerHandle, startWranglerInstance } from '../../server/test/helpers/wrangler'
import { createRollout, createRun, endRollout, ping, scoreFromText } from '../src/api'
import type { Config } from '../src/config'
import { Observer } from '../src/ws'
import { makeTempDir, rmTempDir, runCli, waitPortFree } from './helpers/cli'

const PORT = 8789
let server: ServerHandle
let config: Config
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 述語が真になるまで待つ(タイムアウトで false)。
async function waitUntil(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return true
    await sleep(50)
  }
  return pred()
}

// 起動直後のリロード窓を人間往復で温める(server テストの primeRoundTrip 相当)。
async function prime(): Promise<void> {
  const s = await HumanSim.connect(server.wsUrl(server.token))
  s.onRequest((req) => s.respond(req.requestId, 'prime'))
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${server.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` },
      body: JSON.stringify({
        model: 'human',
        messages: [{ role: 'user', content: 'p' }],
        stream: false,
      }),
    })
    const ok = res.status === 200
    await res.text()
    if (ok) break
    await sleep(200)
  }
  s.close()
}

beforeAll(async () => {
  // 直前の反復実行で残った workerd がポートを保持していることがあるので、解放を待ってから起動する。
  await waitPortFree(PORT)
  server = await startWranglerInstance({ port: PORT, inspectorPort: 9789 })
  config = { server: server.baseUrl, token: server.token }
  await prime()
}, 90_000)

afterAll(async () => {
  await server?.stop()
  // 次の反復実行が同じポートで衝突しないよう、workerd が解放するまで待つ。
  await waitPortFree(PORT)
})

// ---------- login ----------

describe('login', () => {
  test('正トークン → 設定を保存し疎通 OK', async () => {
    const xdg = makeTempDir('login-ok')
    try {
      const r = await runCli(['login', '--server', server.baseUrl, '--token', server.token], {
        XDG_CONFIG_HOME: xdg,
      })
      expect(r.exitCode).toBe(0)
      const path = join(xdg, 'hllm', 'config.json')
      expect(existsSync(path)).toBe(true)
      const saved = JSON.parse(readFileSync(path, 'utf8')) as Config
      expect(saved.server).toBe(server.baseUrl)
      expect(saved.token).toBe(server.token)
    } finally {
      rmTempDir(xdg)
    }
  }, 20_000)

  test('誤トークン → 疎通失敗で設定を保存しない(exit 1)', async () => {
    const xdg = makeTempDir('login-bad')
    try {
      const r = await runCli(['login', '--server', server.baseUrl, '--token', 'wrong-token'], {
        XDG_CONFIG_HOME: xdg,
      })
      expect(r.exitCode).toBe(1)
      expect(existsSync(join(xdg, 'hllm', 'config.json'))).toBe(false)
    } finally {
      rmTempDir(xdg)
    }
  }, 20_000)

  test('--skip-ping は疎通確認せず保存(オフライン設定)', async () => {
    const xdg = makeTempDir('login-skip')
    try {
      const r = await runCli(
        ['login', '--server', 'http://192.0.2.1:9', '--token', 'tok', '--skip-ping'],
        { XDG_CONFIG_HOME: xdg },
      )
      expect(r.exitCode).toBe(0)
      expect(existsSync(join(xdg, 'hllm', 'config.json'))).toBe(true)
    } finally {
      rmTempDir(xdg)
    }
  }, 20_000)
})

// ---------- runs API クライアント ----------

describe('runs API クライアント', () => {
  test('ping → human モデル', async () => {
    const models = await ping(config)
    expect(models).toContain('human')
  })

  test('run/rollout 作成 → [SCORE] テキスト採点で永続化', async () => {
    const run = await createRun(config, 'CLI テスト run')
    expect(run.id).toBeTruthy()
    const rollout = await createRollout(config, run.id, '設計課題')
    expect(rollout.runId).toBe(run.id)
    const scored = await scoreFromText(config, rollout.id, '良い。[SCORE: 6.0/10]')
    expect(scored.score?.value).toBe(6.0)
    expect(scored.score?.max).toBe(10)
  })

  test('タグ無しテキスト採点 → 422 で throw', async () => {
    const run = await createRun(config, 'タグ無し run')
    const rollout = await createRollout(config, run.id, 'x')
    await expect(scoreFromText(config, rollout.id, 'タグを忘れた講評')).rejects.toThrow('422')
  })

  test('存在しない run への rollout 作成 → 404 で throw', async () => {
    await expect(createRollout(config, 'no-such-run', 'x')).rejects.toThrow('404')
  })

  test('endRollout: score なしで終端記録(endedAt 設定・score なし)', async () => {
    const run = await createRun(config, 'end run')
    const rollout = await createRollout(config, run.id, 'task')
    expect(rollout.endedAt).toBeUndefined()
    const ended = await endRollout(config, rollout.id)
    expect(ended.endedAt).toBeGreaterThan(0)
    expect(ended.score).toBeUndefined()
  })

  test('endRollout: 存在しない rollout → 404 で throw', async () => {
    await expect(endRollout(config, 'no-such-rollout')).rejects.toThrow('404')
  })
})

// ---------- Observer(WS クライアント) ----------

describe('Observer', () => {
  test('request / thought / answered / score を受信する', async () => {
    const observer = new Observer({ server: server.baseUrl, token: server.token })
    await observer.connect()
    const sim = await HumanSim.connect(server.wsUrl(server.token))
    try {
      // 出題 → 人間が思考 → 回答。
      sim.onRequest((req) => {
        sim.reasoning(req.requestId, '観測用の思考')
        setTimeout(() => sim.respond(req.requestId, '観測用の回答'), 40)
      })
      const res = await fetch(`${server.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` },
        body: JSON.stringify({
          model: 'human',
          messages: [{ role: 'user', content: '観測テスト' }],
          stream: false,
        }),
      })
      await res.json()

      const got = (t: string) => observer.received.some((m) => m.type === t)
      expect(await waitUntil(() => got('request'), 8000)).toBe(true)
      expect(await waitUntil(() => got('thought'), 8000)).toBe(true)
      expect(await waitUntil(() => got('answered'), 8000)).toBe(true)

      // score は runs API 経由で発火する。
      const run = await createRun(config, 'observer score run')
      const rollout = await createRollout(config, run.id, 'task')
      await scoreFromText(config, rollout.id, '[SCORE: 9.0/10]')
      expect(
        await waitUntil(
          () => observer.received.some((m) => m.type === 'score' && m.rolloutId === rollout.id),
          8000,
        ),
      ).toBe(true)
    } finally {
      sim.close()
      observer.close()
    }
  }, 30_000)

  test('再接続で同一 requestId の request が重複しない(snapshot 重複排除)', async () => {
    // 応答しないまま in-flight にした pending を作る。default インスタンスは 30 分タイムアウトなので保持される。
    const observer = new Observer({ server: server.baseUrl, token: server.token })
    await observer.connect()
    const answerer = await HumanSim.connect(server.wsUrl(server.token))
    const controller = new AbortController()
    let ssePromise: Promise<Response> | null = null
    try {
      // 誰も答えないストリーム出題(observer と answerer は受信するが answerer は保留)。
      ssePromise = fetch(`${server.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` },
        body: JSON.stringify({
          model: 'human',
          messages: [{ role: 'user', content: '再接続 dedup テスト' }],
          stream: true,
        }),
        signal: controller.signal,
      })
      // SSE を裏で読み続けて接続を in-flight に保つ。
      const sseRead = ssePromise
        .then((r) => r.body?.getReader())
        .then(async (reader) => {
          if (!reader) return
          try {
            for (;;) {
              const { done } = await reader.read()
              if (done) break
            }
          } catch {
            // abort で例外になるのは想定内
          }
        })

      // observer が最初の request を 1 件受信するまで待つ。
      expect(await waitUntil(() => observer.received.some((m) => m.type === 'request'), 8000)).toBe(
        true,
      )
      const reqId = observer.received.find((m) => m.type === 'request')?.requestId
      expect(reqId).toBeTruthy()
      const countRequests = () =>
        observer.received.filter((m) => m.type === 'request' && m.requestId === reqId).length
      expect(countRequests()).toBe(1)

      // 内部 WS を強制切断(closed=false のまま)→ 自動再接続で server が同 requestId のスナップショットを再送。
      const internal = observer as unknown as { ws: WebSocket | null }
      internal.ws?.close()
      // 再接続(バックオフ 500ms)+ スナップショット再送を待つ。
      await sleep(2500)

      // 重複排除により同 requestId の request は依然 1 件のまま。
      expect(countRequests()).toBe(1)

      // 後片付け: answerer が回答して pending を解消し、SSE を完了させる。
      answerer.respond(reqId as string, '片付け回答')
      await sseRead.catch(() => {})
    } finally {
      controller.abort()
      answerer.close()
      observer.close()
    }
  }, 30_000)

  test('切断中に完了した終端を再接続で replay 受理し、重複処理しない', async () => {
    // まず 1 リクエストを完了させ、server の終端履歴(24h 窓)に answered を残す。
    const answerer = await HumanSim.connect(server.wsUrl(server.token))
    let reqId = ''
    answerer.onRequest((req) => {
      reqId = req.requestId
      answerer.respond(req.requestId, 'replay 対象の回答')
    })
    const done = await fetch(`${server.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` },
      body: JSON.stringify({
        model: 'human',
        messages: [{ role: 'user', content: 'replay 元リクエスト' }],
        stream: false,
      }),
    })
    await done.json()
    expect(reqId).toBeTruthy()

    // 完了後に接続する Observer は、接続時に answered を replay: true 付きで受け取る。
    const observer = new Observer({ server: server.baseUrl, token: server.token })
    await observer.connect()
    try {
      const answeredFor = () =>
        observer.received.filter((m) => m.type === 'answered' && m.requestId === reqId)
      expect(await waitUntil(() => answeredFor().length >= 1, 8000)).toBe(true)
      // 受理された終端は replay フラグ付き(切断窓で完了したものの復旧)。
      const first = answeredFor()[0] as unknown as { replay?: boolean }
      expect(first.replay).toBe(true)
      expect(answeredFor().length).toBe(1)

      // 強制再接続 → server が同じ answered を再度 replay → 終端 key dedup で 1 件のまま。
      const internal = observer as unknown as { ws: WebSocket | null }
      internal.ws?.close()
      await sleep(2500)
      expect(answeredFor().length).toBe(1)
    } finally {
      answerer.close()
      observer.close()
    }
  }, 30_000)

  test('マーカー相関: 無関係リクエスト(マーカー無し)を並行発行しても rollout が誤終了しない', async () => {
    const observer = new Observer({ server: server.baseUrl, token: server.token })
    await observer.connect()
    const sim = await HumanSim.connect(server.wsUrl(server.token))
    sim.onRequest((req) => sim.respond(req.requestId, 'ans'))
    const marker = `[hllm:rollout:corr-${Date.now()}]`

    const post = async (content: string) => {
      const res = await fetch(`${server.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` },
        body: JSON.stringify({
          model: 'human',
          messages: [{ role: 'user', content }],
          stream: false,
        }),
      })
      await res.json()
    }

    try {
      const mark = observer.received.length
      // 1) rollout 進行を模す: まずマーカー無しの無関係リクエストを回答まで完了させる。
      await post('無関係なリクエスト(マーカー無し)')
      expect(
        await waitUntil(
          () => observer.received.slice(mark).some((m) => m.type === 'answered'),
          8000,
        ),
      ).toBe(true)

      // 2) マーカー付き request がまだ無いので、waitForRolloutEnd は誤終了しないはず。
      let ended = false
      const endP = observer.waitForRolloutEnd(mark, marker, 20_000).then((e) => {
        ended = true
        return e
      })
      endP.catch(() => {})
      await sleep(600)
      expect(ended).toBe(false)

      // 3) マーカー付き request を発行 → 回答 → waitForRolloutEnd はそれだけを終端として返す。
      await post(`本題の出題です。\n\n${marker}`)
      const end = await Promise.race([endP, sleep(8000).then(() => null)])
      expect(end).not.toBeNull()
      const resolved = end as NonNullable<typeof end>
      expect(resolved.msg.type).toBe('answered')

      // 帰属した requestId はマーカー付き request のもの。無関係 request の id は集合に含まれない。
      const markerReq = observer.received.find(
        (m) => m.type === 'request' && m.messages.some((cm) => cm.content.includes(marker)),
      )
      const unrelatedReq = observer.received
        .slice(mark)
        .find((m) => m.type === 'request' && !m.messages.some((cm) => cm.content.includes(marker)))
      expect(markerReq).toBeDefined()
      expect(unrelatedReq).toBeDefined()
      const markerReqId = (markerReq as { requestId: string }).requestId
      const unrelatedReqId = (unrelatedReq as { requestId: string }).requestId
      expect(resolved.msg.requestId).toBe(markerReqId)
      expect(resolved.requestIds.has(markerReqId)).toBe(true)
      expect(resolved.requestIds.has(unrelatedReqId)).toBe(false)
    } finally {
      sim.close()
      observer.close()
    }
  }, 30_000)
})

// ---------- theater ----------

describe('theater', () => {
  test('WS イベントを受けて request / answered / score が出力に現れる', async () => {
    const xdg = makeTempDir('theater')
    const proc = Bun.spawn(['bun', join(import.meta.dir, '..', 'src', 'index.ts'), 'theater'], {
      env: {
        ...process.env,
        XDG_CONFIG_HOME: xdg,
        HLLM_SERVER: server.baseUrl,
        HLLM_TOKEN: server.token,
        NO_COLOR: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    let out = ''
    const reader = proc.stdout.getReader()
    const dec = new TextDecoder()
    const pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          out += dec.decode(value, { stream: true })
        }
      } catch {
        // kill 後の読み取り例外は無視
      }
    })()

    const sim = await HumanSim.connect(server.wsUrl(server.token))
    try {
      // theater の WS 接続確立を待つ。
      expect(await waitUntil(() => out.includes('WS 接続'), 10_000)).toBe(true)

      // 出題 → 回答 → theater が request / answered を表示。
      sim.onRequest((req) => {
        sim.reasoning(req.requestId, 'theater 用思考')
        setTimeout(() => sim.respond(req.requestId, 'theater 用回答'), 40)
      })
      const res = await fetch(`${server.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` },
        body: JSON.stringify({
          model: 'human',
          messages: [{ role: 'user', content: 'theater テスト' }],
          stream: false,
        }),
      })
      await res.json()

      // 採点 → score 表示。
      const run = await createRun(config, 'theater score run')
      const rollout = await createRollout(config, run.id, 'task')
      await scoreFromText(config, rollout.id, '[SCORE: 8.0/10]')

      expect(
        await waitUntil(
          () => out.includes('request') && out.includes('answered') && out.includes('score'),
          10_000,
        ),
      ).toBe(true)
    } finally {
      sim.close()
      proc.kill('SIGINT')
      await proc.exited
      await pump
      rmTempDir(xdg)
    }
  }, 30_000)
})
