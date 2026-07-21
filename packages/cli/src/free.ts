// `hllm free` — トレーナー・採点なしの自由入力対話 REPL。
//   stdin からプロンプトを読み(初回は引数でも可)、殻(既定 claude)がサーバーへ中継 →
//   ブラウザの人間が回答 → thought / tool_called / answered をライブ表示 → 次の入力待ち。
//   2 回目以降は殻の resume(sessionId 追跡)で会話継続。run/rollout/score は永続化しない。
//
// train と同じ堅牢性(マーカー相関・有界 join・kill・1 行エラー)を流用しつつ、
// 殻失敗時も REPL を壊さず「失敗しました」表示で次の入力へ進む。

import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Config } from './config'
import { bold, cyan, dim, error, info, warn, yellow } from './log'
import { createShell, type ShellHandle, type ShellKind } from './shell'
import { renderEvent } from './transcript'
import { Observer } from './ws'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 終端イベント取得後に殻の終了を待つ上限。ハングしたら kill して次へ進む。
const CHILD_JOIN_MS = 30_000
// kill 後の 2 段目 join の上限(無限 await を避ける有界待ち)。
const CHILD_JOIN_2_MS = 5_000
// 「殻が正常終了したのに終端が未着」の場合に終端を待つ短いグレース。
const TERMINAL_GRACE_MS = 5_000

export type FreeOptions = {
  config: Config
  shell: ShellKind
  initialPrompt?: string
  cwd?: string
  keepWorkdir: boolean
  timeoutMs: number
}

// stdin を 1 行ずつ「要求されたら次を返す」形で読むリーダ(TTY / パイプ両対応)。
function makeLineReader(): { next: () => Promise<string | null>; close: () => void } {
  const rl = createInterface({ input: process.stdin, terminal: false })
  const queue: string[] = []
  let waiting: ((v: string | null) => void) | null = null
  let closed = false
  rl.on('line', (line) => {
    if (waiting) {
      waiting(line)
      waiting = null
    } else queue.push(line)
  })
  rl.on('close', () => {
    closed = true
    if (waiting) {
      waiting(null)
      waiting = null
    }
  })
  return {
    next: () => {
      const q = queue.shift()
      if (q !== undefined) return Promise.resolve(q)
      if (closed) return Promise.resolve(null)
      return new Promise<string | null>((res) => {
        waiting = res
      })
    },
    close: () => rl.close(),
  }
}

export async function runFree(opts: FreeOptions): Promise<number> {
  // 殻の作業ディレクトリ(train と同じ既定: 中立の一時 dir を作り終了時に削除)。
  const ephemeralWorkdir = opts.cwd === undefined
  const workdir = opts.cwd ?? join(tmpdir(), `hllm-shell-${crypto.randomUUID()}`)
  if (ephemeralWorkdir) mkdirSync(workdir, { recursive: true })

  const shell = createShell(opts.shell, {
    config: opts.config,
    profile: 'hllm-free',
    cwd: workdir,
    timeoutMs: opts.timeoutMs,
    echo: false,
  })

  const inflight: { handle: ShellHandle | null } = { handle: null }
  let observer: Observer | null = null
  let resumeId: string | null = null
  const reader = makeLineReader()

  const cleanupWorkdir = () => {
    if (!ephemeralWorkdir || opts.keepWorkdir) return
    try {
      rmSync(workdir, { recursive: true, force: true })
    } catch {
      // 消せなければ諦める
    }
  }

  const onSigint = () => {
    warn('SIGINT — 終了します')
    inflight.handle?.kill()
    observer?.close()
    reader.close()
    cleanupWorkdir()
    process.exit(130)
  }
  process.on('SIGINT', onSigint)

  info(bold('💬 hllm free'))
  info(dim(`   殻: ${shell.displayName} / サーバー: ${opts.config.server}`))
  info(
    dim(
      `   殻の作業場: ${workdir}${ephemeralWorkdir ? ' (中立一時・終了後に削除)' : ' (--cwd 指定)'}`,
    ),
  )
  info(dim('   /new で新規セッション、/exit で終了(Ctrl-C でも可)'))

  try {
    await shell.setup(false)

    observer = new Observer({
      server: opts.config.server,
      token: opts.config.token,
      onStatus: (s) => {
        if (s !== 'open') warn(dim(`WS: ${s}`))
      },
    })
    await observer.connect()
    const obs = observer
    obs.subscribe((m) => {
      // 再接続時の replay(過去セッションの終端イベント再送)は表示しない。
      if ('replay' in m && m.replay) return
      const line = renderEvent(m)
      if (line && (m.type === 'thought' || m.type === 'tool_called' || m.type === 'answered'))
        info(line)
    })

    // 殻の完了を待って exit code を返す(resumeId 書き戻し)。30s cap 超過で kill → 2 段目有界 join。
    const joinChild = async (handle: ShellHandle): Promise<number | null> => {
      const raceJoin = (ms: number) =>
        Promise.race([
          handle.promise.then((r) => ({ done: true as const, r })),
          sleep(ms).then(() => ({ done: false as const })),
        ])
      const first = await raceJoin(CHILD_JOIN_MS)
      if (first.done) {
        if (first.r.sessionId) resumeId = first.r.sessionId
        return first.r.exitCode
      }
      warn(dim('殻の終了待ちがタイムアウト — kill して短く待ちます'))
      handle.kill()
      const second = await raceJoin(CHILD_JOIN_2_MS)
      if (second.done) {
        if (second.r.sessionId) resumeId = second.r.sessionId
        return second.r.exitCode
      }
      return null
    }

    // 1 往復を実行する。失敗しても REPL は壊さず、警告だけ出して戻る。
    const runTurn = async (prompt: string): Promise<void> => {
      const marker = `[hllm:free:${crypto.randomUUID()}]`
      const injected = `${prompt}\n\n${marker}`
      const mark = obs.received.length
      const controller = new AbortController()
      const handle = shell.runHeadless(injected, resumeId)
      inflight.handle = handle
      try {
        const termP = obs
          .waitForRolloutEnd(mark, marker, opts.timeoutMs, controller.signal)
          .then((end) => ({ kind: 'term' as const, end }))
        termP.catch(() => {}) // 敗者側 waiter の late abort rejection を握り潰す
        const childP = handle.promise.then(
          (res) => ({ kind: 'child' as const, res }),
          (err) => ({ kind: 'childErr' as const, err: err as Error }),
        )
        const first = await Promise.race([termP, childP])

        if (first.kind === 'childErr') {
          warn(yellow(`殻の実行に失敗しました: ${first.err.message}`))
          return
        }
        if (first.kind === 'child' && first.res.exitCode !== 0) {
          if (first.res.sessionId) resumeId = first.res.sessionId
          warn(yellow(`殻が失敗しました(exit=${first.res.exitCode})— もう一度どうぞ`))
          return
        }

        let end = first.kind === 'term' ? first.end : null
        if (!end) {
          end = await obs.waitForRolloutEnd(mark, marker, TERMINAL_GRACE_MS).catch(() => null)
          if (!end) {
            warn(yellow('回答が届きませんでした — もう一度どうぞ'))
            return
          }
        }

        const childExit = await joinChild(handle)
        await sleep(200) // trailing イベントの取りこぼし防止
        if (end.msg.type === 'timeout') warn(yellow('タイムアウトしました(人間から回答なし)'))
        else if (childExit !== 0 && childExit !== null)
          warn(dim(`(殻は非ゼロ終了 exit=${childExit} だが回答は取得済み)`))
      } finally {
        controller.abort()
        inflight.handle = null
      }
    }

    // REPL。初回のみ引数プロンプトを使い、以後は stdin を読む。
    let pending = opts.initialPrompt
    for (;;) {
      let input: string | null
      if (pending !== undefined) {
        input = pending
        pending = undefined
        info(`${cyan('▷')} ${input}`)
      } else {
        process.stdout.write(cyan('▷ '))
        input = await reader.next()
        if (input === null) {
          info('') // EOF(Ctrl-D)
          break
        }
      }
      const text = input.trim()
      if (text === '') continue
      if (text === '/exit') break
      if (text === '/new') {
        resumeId = null
        info(dim('   (新しいセッションを開始します)'))
        continue
      }
      await runTurn(text)
      info('')
    }
    return 0
  } catch (e) {
    error(`free が失敗しました: ${(e as Error).message}`)
    return 1
  } finally {
    process.off('SIGINT', onSigint)
    inflight.handle?.kill()
    observer?.close()
    reader.close()
    cleanupWorkdir()
  }
}
