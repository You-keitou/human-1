// train ループの E2E(核心)。
// 実 wrangler dev + フェイク実行ファイルでフルループを通す:
//   フェイク claude(トレーナー役) … rubric/出題 と [SCORE: x.x/10] 採点を canned JSON で返す。
//   フェイク codex(殻役)          … /v1/responses に POST して人間へ出題を発火させる。
//   人間シミュレータ(HumanSim)     … WS で回答(タイムアウト検証では回答しない)。
// 検証観点:
//   1. 出題 → 回答 → 採点 → runs API に score 永続化(学習曲線)
//   2. タイムアウト経路: 人間無回答 → WS timeout → 採点スキップ(score 保存されない)
//   3. `claude -p --resume` の session_id fork 追跡(フェイクの受信引数記録で検証)
// 短めの HUMAN_TIMEOUT_MS(8s)を注入した専用インスタンス(ポート 8790)を使う。
// 正常経路では人間が即答するので 8s には触れない。

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { HumanSim } from '../../server/test/helpers/humansim'
import { type ServerHandle, startWranglerInstance } from '../../server/test/helpers/wrangler'
import type { Rollout, TrainingRun } from '../src/api'
import {
  cliLauncher,
  makeTempDir,
  readJsonl,
  rmTempDir,
  waitPortFree,
  writeFakes,
} from './helpers/cli'

const PORT = 8790
let server: ServerHandle
let sim: HumanSim
const HUMAN_TIMEOUT_MS = 8000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

// CLI stdout から `run: <uuid>` を拾う。
function extractRunId(stdout: string): string | null {
  const m = stdout.match(/run:\s*([0-9a-f-]{36})/i)
  return m ? (m[1] as string) : null
}

async function getRun(runId: string): Promise<{ run: TrainingRun; rollouts: Rollout[] }> {
  const res = await fetch(`${server.baseUrl}/api/runs/${runId}`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  return (await res.json()) as { run: TrainingRun; rollouts: Rollout[] }
}

// train を子プロセスで実行する。フェイク dir を PATH 先頭に置き、殻/トレーナーを差し替える。
async function runTrain(
  args: string[],
  fakeDir: string,
  codexHome: string,
  xdg: string,
  extraEnv: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([...cliLauncher, ...args], {
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
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

beforeAll(async () => {
  // 直前の反復実行で残った workerd がポートを保持していることがあるので、解放を待ってから起動する。
  await waitPortFree(PORT)
  server = await startWranglerInstance({
    port: PORT,
    inspectorPort: 9790,
    vars: { HUMAN_TIMEOUT_MS: String(HUMAN_TIMEOUT_MS) },
  })
  sim = await HumanSim.connect(server.wsUrl(server.token))
  await prime()
}, 90_000)

afterAll(async () => {
  sim?.close()
  await server?.stop()
  // 次の反復実行が同じポートで衝突しないよう、workerd が解放するまで待つ。
  await waitPortFree(PORT)
})

describe('train フルループ', () => {
  test('出題 → 回答 → 採点 → score 永続化(学習曲線)と trainer resume fork 追跡', async () => {
    const fakeDir = makeTempDir('train-ok-fakes')
    const codexHome = makeTempDir('train-ok-codex')
    const xdg = makeTempDir('train-ok-xdg')
    writeFakes(fakeDir)
    // 人間はすべての出題に即答する。
    sim.reset()
    sim.onRequest((req) => sim.respond(req.requestId, '人間の回答: 実装しました'))

    try {
      const r = await runTrain(
        ['train', 'テストドメイン', '--shell', 'codex', '--epochs', '2', '--profile', 'hllm'],
        fakeDir,
        codexHome,
        xdg,
      )
      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0)

      // 学習曲線が 2 点(7.5 → 8.0)出ている。
      expect(r.stdout).toContain('7.5')
      expect(r.stdout).toContain('8')
      expect(r.stdout).toContain('学習曲線')

      // score が永続化されている。
      const runId = extractRunId(r.stdout)
      expect(runId).toBeTruthy()
      const { rollouts } = await getRun(runId as string)
      expect(rollouts.length).toBe(2)
      const values = rollouts.map((ro) => ro.score?.value).sort()
      expect(values).toEqual([7.5, 8.0])

      // トレーナー(claude)の resume fork 追跡: 各回で新 session_id を返し、次回はそれで --resume。
      const log = readJsonl(`${fakeDir}/trainer-log.jsonl`)
      expect(log.length).toBe(3) // kickoff + eval1 + eval2
      expect(log[0]?.isEval).toBe(false)
      expect(log[0]?.resume).toBeNull()
      expect(log[0]?.returnedSessionId).toBe('sess-1')
      expect(log[1]?.isEval).toBe(true)
      expect(log[1]?.resume).toBe('sess-1') // 前回返した session で resume
      expect(log[2]?.isEval).toBe(true)
      expect(log[2]?.resume).toBe('sess-2')

      // 殻(codex)は各 rollout で 1 回ずつ起動している。
      const codexLog = readJsonl(`${fakeDir}/codex-log.jsonl`)
      expect(codexLog.length).toBe(2)
    } finally {
      rmTempDir(fakeDir)
      rmTempDir(codexHome)
      rmTempDir(xdg)
    }
  }, 60_000)

  test('タイムアウト経路: 人間無回答 → WS timeout → 採点スキップ(score 保存されない)', async () => {
    const fakeDir = makeTempDir('train-to-fakes')
    const codexHome = makeTempDir('train-to-codex')
    const xdg = makeTempDir('train-to-xdg')
    writeFakes(fakeDir)
    // 人間は回答しない(requestId だけ来ても放置)。
    sim.reset()
    sim.onRequest(() => {
      /* 無反応 */
    })

    try {
      const r = await runTrain(
        ['train', 'タイムアウト検証', '--shell', 'codex', '--epochs', '1', '--profile', 'hllm'],
        fakeDir,
        codexHome,
        xdg,
      )
      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0)

      // タイムアウト告知が出る。
      expect(r.stdout + r.stderr).toContain('タイムアウト')
      // 誤採点防止: 「score ... を保存」は出ない(フェイクは [SCORE] を返すが CLI がスキップする)。
      expect(r.stdout).not.toContain('を保存')

      // 永続化上も score が付いていない。
      const runId = extractRunId(r.stdout)
      expect(runId).toBeTruthy()
      const { rollouts } = await getRun(runId as string)
      expect(rollouts.length).toBe(1)
      expect(rollouts[0]?.score).toBeUndefined()
    } finally {
      rmTempDir(fakeDir)
      rmTempDir(codexHome)
      rmTempDir(xdg)
    }
  }, 60_000)

  test('殻の子異常終了 → タイムアウトを待たず即失敗・endedAt 記録・score なし', async () => {
    const fakeDir = makeTempDir('train-fail-fakes')
    const codexHome = makeTempDir('train-fail-codex')
    const xdg = makeTempDir('train-fail-xdg')
    writeFakes(fakeDir)
    // 殻の子は POST せず即 exit 3。人間には何も届かない。
    sim.reset()
    sim.onRequest((req) => sim.respond(req.requestId, '(届かないはず)'))

    try {
      const start = Date.now()
      const r = await runTrain(
        // --timeout 60s: もし殻失敗を検知できず WS 終端を待つなら 60s 掛かる。即失敗なら数秒で終わる。
        [
          'train',
          '殻失敗検証',
          '--shell',
          'codex',
          '--epochs',
          '1',
          '--profile',
          'hllm',
          '--timeout',
          '60000',
        ],
        fakeDir,
        codexHome,
        xdg,
        { HLLM_FAKE_CODEX_MODE: 'fail' },
      )
      const elapsed = Date.now() - start

      // タイムアウト(60s)を待たずに終わっている(即失敗)。
      expect(elapsed).toBeLessThan(20_000)
      // 殻失敗のログが出る。
      expect(r.stdout + r.stderr).toContain('失敗')
      // 採点はされない。
      expect(r.stdout).not.toContain('を保存')

      // rollout は endedAt 記録あり・score なしで終端している。
      const runId = extractRunId(r.stdout)
      expect(runId).toBeTruthy()
      const { rollouts } = await getRun(runId as string)
      expect(rollouts.length).toBe(1)
      expect(rollouts[0]?.score).toBeUndefined()
      expect(rollouts[0]?.endedAt).toBeGreaterThan(0)

      // 殻(インフラ)失敗が 1 件でもあれば最終 exit code は非ゼロ(要件4)。
      expect(r.exitCode).toBe(1)
    } finally {
      rmTempDir(fakeDir)
      rmTempDir(codexHome)
      rmTempDir(xdg)
    }
  }, 90_000)

  test('殻の遅延 exit → 次 rollout の resume が前 session_id(子完了 await の検証)', async () => {
    const fakeDir = makeTempDir('train-slow-fakes')
    const codexHome = makeTempDir('train-slow-codex')
    const xdg = makeTempDir('train-slow-xdg')
    writeFakes(fakeDir)
    // 人間は即答するが、殻の子は回答後さらに 2.5s 生きてから session を出して exit する。
    sim.reset()
    sim.onRequest((req) => sim.respond(req.requestId, '人間の回答'))

    try {
      const r = await runTrain(
        ['train', '遅延exit検証', '--shell', 'codex', '--epochs', '2', '--profile', 'hllm'],
        fakeDir,
        codexHome,
        xdg,
        { HLLM_FAKE_CODEX_MODE: 'slow', HLLM_FAKE_CODEX_DELAY_MS: '2500' },
      )
      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0)

      // 殻は 2 rollout ぶん起動している。
      const codexLog = readJsonl(`${fakeDir}/codex-log.jsonl`)
      expect(codexLog.length).toBe(2)
      // 2 回目の resume は 1 回目が出した session_id(子完了を await して書き戻せている)。
      const first = codexLog[0] as { returnedSessionId: string }
      const second = codexLog[1] as { resume: string | null }
      expect(second.resume).toBe(first.returnedSessionId)
    } finally {
      rmTempDir(fakeDir)
      rmTempDir(codexHome)
      rmTempDir(xdg)
    }
  }, 90_000)

  test('トレーナー環境隔離: 子に ANTHROPIC_API_KEY 等が渡らない', async () => {
    const fakeDir = makeTempDir('train-env-fakes')
    const codexHome = makeTempDir('train-env-codex')
    const xdg = makeTempDir('train-env-xdg')
    writeFakes(fakeDir)
    sim.reset()
    sim.onRequest((req) => sim.respond(req.requestId, '人間の回答'))

    try {
      const r = await runTrain(
        ['train', '環境隔離検証', '--shell', 'codex', '--epochs', '1', '--profile', 'hllm'],
        fakeDir,
        codexHome,
        xdg,
        {
          // これらが親環境にあってもトレーナー子には渡ってはいけない。
          ANTHROPIC_API_KEY: 'sk-should-be-stripped',
          ANTHROPIC_AUTH_TOKEN: 'auth-should-be-stripped',
          ANTHROPIC_BASE_URL: 'http://should-be-stripped',
          CLAUDE_CODE_USE_BEDROCK: '1',
        },
      )
      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0)

      // フェイク claude(トレーナー)が受け取った env のダンプ。すべて欠落(null)であること。
      const envSeen = JSON.parse(readFileSync(`${fakeDir}/trainer-env.json`, 'utf8')) as Record<
        string,
        string | null
      >
      expect(envSeen.ANTHROPIC_API_KEY).toBeNull()
      expect(envSeen.ANTHROPIC_AUTH_TOKEN).toBeNull()
      expect(envSeen.ANTHROPIC_BASE_URL).toBeNull()
      expect(envSeen.CLAUDE_CODE_USE_BEDROCK).toBeNull()
    } finally {
      rmTempDir(fakeDir)
      rmTempDir(codexHome)
      rmTempDir(xdg)
    }
  }, 90_000)

  test('回答受信後に殻が非ゼロ終了 → 失敗・score なし・exit 1(race 勝敗に非依存)', async () => {
    const fakeDir = makeTempDir('train-af-fakes')
    const codexHome = makeTempDir('train-af-codex')
    const xdg = makeTempDir('train-af-xdg')
    writeFakes(fakeDir)
    // 人間は即答する(answered が先に届く)。殻はその後 exit 3。
    let answered = false
    sim.reset()
    sim.onRequest((req) => {
      answered = true
      sim.respond(req.requestId, '人間の回答(だが殻は失敗する)')
    })

    try {
      const r = await runTrain(
        ['train', '回答後殻失敗検証', '--shell', 'codex', '--epochs', '1', '--profile', 'hllm'],
        fakeDir,
        codexHome,
        xdg,
        { HLLM_FAKE_CODEX_MODE: 'answerfail' },
      )
      // 人間は実際に回答している(= answered が届いたが殻失敗で無効化される)。
      expect(answered).toBe(true)
      // 殻(インフラ)失敗なので最終 exit code は非ゼロ。
      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(1)
      // 採点はされず、サマリに殻失敗が計上される。
      expect(r.stdout).not.toContain('を保存')
      expect(r.stdout).toContain('殻失敗 1')

      // 永続化上も score なし・endedAt 記録あり。
      const runId = extractRunId(r.stdout)
      expect(runId).toBeTruthy()
      const { rollouts } = await getRun(runId as string)
      expect(rollouts.length).toBe(1)
      expect(rollouts[0]?.score).toBeUndefined()
      expect(rollouts[0]?.endedAt).toBeGreaterThan(0)
    } finally {
      rmTempDir(fakeDir)
      rmTempDir(codexHome)
      rmTempDir(xdg)
    }
  }, 90_000)

  test('トレーナー例外 → active rollout が endedAt 付きで閉じ exit 1', async () => {
    const fakeDir = makeTempDir('train-terr-fakes')
    const codexHome = makeTempDir('train-terr-codex')
    const xdg = makeTempDir('train-terr-xdg')
    writeFakes(fakeDir)
    // 殻は正常(回答が返る)。トレーナーは kickoff は成功、採点(エポック)呼び出しで例外。
    sim.reset()
    sim.onRequest((req) => sim.respond(req.requestId, '人間の回答'))

    try {
      const r = await runTrain(
        ['train', 'トレーナー例外検証', '--shell', 'codex', '--epochs', '1', '--profile', 'hllm'],
        fakeDir,
        codexHome,
        xdg,
        { HLLM_FAKE_CLAUDE_FAIL_ON_EVAL: '1' },
      )
      // 例外経路で exit 1。
      expect(r.exitCode, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(1)
      expect(r.stdout + r.stderr).toContain('訓練が失敗しました')
      // 採点は走っていない。
      expect(r.stdout).not.toContain('を保存')

      // 開いたままだった active rollout が catch の best-effort /end で endedAt 付きに閉じている。
      const runId = extractRunId(r.stdout)
      expect(runId).toBeTruthy()
      const { rollouts } = await getRun(runId as string)
      expect(rollouts.length).toBe(1)
      expect(rollouts[0]?.score).toBeUndefined()
      expect(rollouts[0]?.endedAt).toBeGreaterThan(0)
    } finally {
      rmTempDir(fakeDir)
      rmTempDir(codexHome)
      rmTempDir(xdg)
    }
  }, 90_000)
})
