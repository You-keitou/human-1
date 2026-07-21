// `hllm free`(新仕様: AI 対話役が無限ループでお題を生成する非採点モード)の回帰テスト。
// 実 wrangler dev + フェイク claude(AI 役: ClaudeTrainer 経由。呼び出しごとに canned お題を返す)
// + フェイク codex(殻役)+ 人間シミュレータ(human-sim)で駆動する。
//   ループ = AI お題 → 殻中継 → 人間回答 → 軌跡を AI に渡して次を生成。
//   stdin 行 = 次の AI 生成への方向づけヒント / /new = AI・殻とも新セッション / /exit・EOF = 終了。
// 往復回数は HLLM_FAKE_CLAUDE_MAX_CALLS(AI 生成失敗でループ終了)か、/exit のペーシングで有界化する。
// 専用ポート 8792(train 8790 / integration 8789 / server 8799・8798 と非衝突)。

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Subprocess } from 'bun'
import { HumanSim } from '../../server/test/helpers/humansim'
import { type ServerHandle, startWranglerInstance } from '../../server/test/helpers/wrangler'
import {
  cliEntry,
  makeTempDir,
  readJsonl,
  rmTempDir,
  waitPortFree,
  writeFakes,
} from './helpers/cli'

const PORT = 8792
let server: ServerHandle
let sim: HumanSim
const HUMAN_TIMEOUT_MS = 8000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitUntil(pred: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return
    await sleep(50)
  }
  throw new Error('waitUntil タイムアウト')
}

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

async function runsCount(): Promise<number> {
  const res = await fetch(`${server.baseUrl}/api/runs`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  const body = (await res.json()) as { runs: unknown[] }
  return body.runs.length
}

type Dirs = { fakeDir: string; codexHome: string; xdg: string }

function makeDirs(tag: string): Dirs {
  const fakeDir = makeTempDir(`free-${tag}-fakes`)
  writeFakes(fakeDir)
  return {
    fakeDir,
    codexHome: makeTempDir(`free-${tag}-codex`),
    xdg: makeTempDir(`free-${tag}-xdg`),
  }
}

function cleanDirs(d: Dirs): void {
  rmTempDir(d.fakeDir)
  rmTempDir(d.codexHome)
  rmTempDir(d.xdg)
}

type FreeResult = { exitCode: number; stdout: string; stderr: string }
type SpawnedFree = {
  proc: Subprocess<'pipe', 'pipe', 'pipe'>
  writeStdin: (s: string) => void
  done: Promise<FreeResult>
}

// free を子プロセスで起動する(--shell codex 固定・AI 役は claude)。
function spawnFree(
  theme: string | undefined,
  { fakeDir, codexHome, xdg }: Dirs,
  extraEnv: Record<string, string> = {},
): SpawnedFree {
  const args = ['free', '--shell', 'codex']
  if (theme !== undefined) args.push(theme)
  const proc = Bun.spawn(['bun', cliEntry, ...args], {
    env: {
      ...process.env,
      PATH: `${fakeDir}:${process.env.PATH}`,
      HLLM_SERVER: server.baseUrl,
      HLLM_TOKEN: server.token,
      HLLM_FAKE_DIR: fakeDir,
      CODEX_HOME: codexHome,
      XDG_CONFIG_HOME: xdg,
      NO_COLOR: '1',
      ...extraEnv,
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const done = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ exitCode, stdout, stderr }))
  return {
    proc,
    writeStdin: (s: string) => {
      proc.stdin.write(s)
      proc.stdin.flush()
    },
    done,
  }
}

// 自動応答(human-sim が全リクエストに即答)で MAX_CALLS まで回して結果を集める。
async function runFreeAuto(
  theme: string | undefined,
  dirs: Dirs,
  extraEnv: Record<string, string> = {},
): Promise<FreeResult> {
  const f = spawnFree(theme, dirs, extraEnv)
  return f.done
}

beforeAll(async () => {
  await waitPortFree(PORT)
  server = await startWranglerInstance({
    port: PORT,
    inspectorPort: 9792,
    vars: { HUMAN_TIMEOUT_MS: String(HUMAN_TIMEOUT_MS) },
  })
  sim = await HumanSim.connect(server.wsUrl(server.token))
  await prime()
}, 90_000)

afterAll(async () => {
  sim?.close()
  await server?.stop()
  await waitPortFree(PORT)
})

describe('hllm free(新仕様: AI 駆動)', () => {
  test('1 往復: AI お題 → 人間回答 → answered 表示 → /exit で exit 0', async () => {
    const d = makeDirs('one')
    const reqs: string[] = []
    sim.reset()
    sim.onRequest((req) => reqs.push(req.requestId))
    try {
      const f = spawnFree(undefined, d, { HLLM_FAKE_CLAUDE_MAX_CALLS: '5' })
      await waitUntil(() => reqs.length >= 1)
      f.writeStdin('/exit\n')
      await sleep(200)
      sim.respond(reqs[0] as string, 'フリー回答です')
      const r = await f.done

      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0)
      expect(r.stdout).toContain('🤖 AI') // AI のお題が表示される
      expect(r.stdout).toContain('answered')
      expect(r.stdout).toContain('フリー回答です')
      // /exit による正常終了(AI 生成失敗の警告は出ない)。
      expect(r.stdout + r.stderr).not.toContain('AI 生成に失敗')
      // AI 1 回・殻 1 回。
      expect(readJsonl(`${d.fakeDir}/trainer-log.jsonl`).length).toBe(1)
      expect(readJsonl(`${d.fakeDir}/codex-log.jsonl`).length).toBe(1)
    } finally {
      cleanDirs(d)
    }
  }, 60_000)

  test('resume: 2 往復目の殻/AI resume 引数が 1 往復目の sessionId', async () => {
    const d = makeDirs('resume')
    sim.reset()
    sim.onRequest((req) => sim.respond(req.requestId, '回答'))
    try {
      const r = await runFreeAuto(undefined, d, { HLLM_FAKE_CLAUDE_MAX_CALLS: '2' })
      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0)

      const codex = readJsonl(`${d.fakeDir}/codex-log.jsonl`)
      const trainer = readJsonl(`${d.fakeDir}/trainer-log.jsonl`)
      expect(codex.length).toBe(2)
      // 殻(codex)の resume 継続。
      const c0 = codex[0] as { returnedSessionId: string; resume: string | null }
      const c1 = codex[1] as { resume: string | null }
      expect(c0.resume).toBeNull()
      expect(c1.resume).toBe(c0.returnedSessionId)
      // AI(claude)の resume 継続(2 回目は 1 回目が返した session で --resume)。
      const t0 = trainer[0] as { returnedSessionId: string; resume: string | null }
      const t1 = trainer[1] as { resume: string | null }
      expect(t0.resume).toBeNull()
      expect(t1.resume).toBe(t0.returnedSessionId)
    } finally {
      cleanDirs(d)
    }
  }, 60_000)

  test('/new: 破棄後の往復は AI・殻とも resume なし(新セッション)', async () => {
    const d = makeDirs('new')
    const reqs: string[] = []
    sim.reset()
    sim.onRequest((req) => reqs.push(req.requestId))
    try {
      const f = spawnFree(undefined, d, { HLLM_FAKE_CLAUDE_MAX_CALLS: '5' })
      // ターン1 の待機中に /new を注入 → ターン1 応答 → ターン2 は新セッション。
      await waitUntil(() => reqs.length >= 1)
      f.writeStdin('/new\n')
      await sleep(400)
      sim.respond(reqs[0] as string, '回答1')
      await waitUntil(() => reqs.length >= 2)
      f.writeStdin('/exit\n')
      await sleep(200)
      sim.respond(reqs[1] as string, '回答2')
      const r = await f.done

      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0)
      expect(r.stdout).toContain('新セッションを開始します')
      const codex = readJsonl(`${d.fakeDir}/codex-log.jsonl`)
      const trainer = readJsonl(`${d.fakeDir}/trainer-log.jsonl`)
      expect(codex.length).toBe(2)
      expect(trainer.length).toBe(2)
      // /new を挟んだ 2 往復目は resume なし(AI・殻とも)。
      expect((codex[1] as { resume: string | null }).resume).toBeNull()
      expect((trainer[1] as { resume: string | null }).resume).toBeNull()
    } finally {
      cleanDirs(d)
    }
  }, 60_000)

  test('永続化なし: 実行後に runs API の run が増えていない', async () => {
    const d = makeDirs('nopersist')
    sim.reset()
    sim.onRequest((req) => sim.respond(req.requestId, '回答'))
    try {
      const before = await runsCount()
      const r = await runFreeAuto(undefined, d, { HLLM_FAKE_CLAUDE_MAX_CALLS: '2' })
      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0)
      expect(await runsCount()).toBe(before)
    } finally {
      cleanDirs(d)
    }
  }, 60_000)

  test('殻異常終了: 警告して次のお題へ続行し、最後は exit 0', async () => {
    const d = makeDirs('shellfail')
    sim.reset()
    sim.onRequest((req) => sim.respond(req.requestId, '2ターン目の回答'))
    try {
      // 1 ターン目の殻は失敗(POST せず exit 3)、2 ターン目は正常。AI は 2 回で打ち切り。
      const r = await runFreeAuto(undefined, d, {
        HLLM_FAKE_CODEX_MODE: 'failonce',
        HLLM_FAKE_CLAUDE_MAX_CALLS: '2',
      })
      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0)
      // 殻失敗の警告が出る。
      expect(r.stdout + r.stderr).toContain('失敗')
      // 続行して 2 ターン目は正常に回答表示。
      expect(r.stdout).toContain('2ターン目の回答')
      // 殻は 2 回起動(失敗 1 + 成功 1)。
      expect(readJsonl(`${d.fakeDir}/codex-log.jsonl`).length).toBe(2)
    } finally {
      cleanDirs(d)
    }
  }, 60_000)

  test('replay 非表示: 過去に完了した answered が free の表示に出ない', async () => {
    const d = makeDirs('replay')
    const past = `過去回答-${Date.now()}`
    const now = `現在回答-${Date.now()}`
    sim.reset()
    sim.onRequest((req) => {
      const joined = req.messages.map((m) => m.content).join(' ')
      sim.respond(req.requestId, joined.includes('PAST-MARK') ? past : now)
    })
    try {
      // free 起動前に別リクエストを完了させ、終端履歴(replay 対象)を作る。
      const res = await fetch(`${server.baseUrl}/v1/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` },
        body: JSON.stringify({ model: 'human', input: 'PAST-MARK 過去のやりとり', stream: false }),
      })
      await res.json()

      // free 起動 → 接続時に過去 answered が replay:true で再送されるが表示しない。
      const r = await runFreeAuto(undefined, d, { HLLM_FAKE_CLAUDE_MAX_CALLS: '1' })
      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0)
      expect(r.stdout).toContain(now) // 現在のやりとりは表示
      expect(r.stdout).not.toContain(past) // 過去(replay)は非表示
    } finally {
      cleanDirs(d)
    }
  }, 60_000)

  test('ヒント注入: stdin ヒントが次の AI 生成プロンプトに反映される', async () => {
    const d = makeDirs('hint')
    const reqs: string[] = []
    sim.reset()
    sim.onRequest((req) => reqs.push(req.requestId))
    try {
      const f = spawnFree(undefined, d, { HLLM_FAKE_CLAUDE_MAX_CALLS: '5' })
      // ターン1 の待機中にヒントを注入 → 応答 → ターン2 の AI 生成に反映される。
      await waitUntil(() => reqs.length >= 1)
      f.writeStdin('SF方向でお願い\n')
      await sleep(400)
      sim.respond(reqs[0] as string, '回答1')
      await waitUntil(() => reqs.length >= 2)
      f.writeStdin('/exit\n')
      await sleep(200)
      sim.respond(reqs[1] as string, '回答2')
      const r = await f.done

      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0)
      // 反映表示。
      expect(r.stdout).toContain('方向づけを反映: SF方向でお願い')
      // 2 回目の AI 生成プロンプトに方向づけが含まれる(フェイク claude の受信記録)。
      const trainer = readJsonl(`${d.fakeDir}/trainer-log.jsonl`)
      expect(trainer.length).toBe(2)
      const t1 = trainer[1] as { prompt: string }
      expect(t1.prompt).toContain('ユーザーからの方向づけ: SF方向でお願い')
    } finally {
      cleanDirs(d)
    }
  }, 60_000)

  test('AI 生成失敗: フェイク claude が exit 1 でループが警告つき終了 exit 0', async () => {
    const d = makeDirs('aifail')
    sim.reset()
    sim.onRequest((req) => sim.respond(req.requestId, '回答'))
    try {
      // 初回 AI 生成から失敗(MAX_CALLS=0)。殻には一度も到達しない。
      const r = await runFreeAuto(undefined, d, { HLLM_FAKE_CLAUDE_MAX_CALLS: '0' })
      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0)
      expect(r.stdout + r.stderr).toContain('AI 生成に失敗')
      // 殻は起動していない(codex-log ファイルなし)。
      expect(readJsonl(`${d.fakeDir}/codex-log.jsonl`).length).toBe(0)
    } finally {
      cleanDirs(d)
    }
  }, 60_000)
})
