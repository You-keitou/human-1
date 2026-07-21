// `hllm free [テーマ]` — トレーナー・採点なしの自由対話モード。
//   AI 対話役(claude -p)が面白いお題/質問を出す → 殻(既定 claude)がサーバー中継 →
//   ブラウザの人間が回答 → AI が回答を読んで短く反応し次のお題/深掘りを出す → 繰り返し。
//   エポック上限なし・/exit まで無限。run/rollout/score は永続化しない。
//
// stdin は「AI への方向づけヒント」(待機中に打つと次の生成に渡す)。
//   /new … AI・殻とも新セッション。/exit・Ctrl-C・Ctrl-D … 後始末して終了。
//
// train と同じ堅牢性(マーカー相関・有界 join・kill・replay 抑制)を流用。殻失敗は警告して
// 次ターンへ、タイムアウトは「スキップして次のお題」。既定 cwd は中立の一時 dir。

import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Config } from './config'
import { bold, dim, error, info, magenta, warn, yellow } from './log'
import { isBunRuntime, PtyBridge } from './pty'
import { createShell, type ShellHandle, type ShellKind } from './shell'
import { ClaudeTrainer } from './trainer'
import { buildTranscript, renderEvent } from './transcript'
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
  theme?: string
  cwd?: string
  keepWorkdir: boolean
  timeoutMs: number
  // TUI 透過。undefined=自動(実 TTY かつ Node なら TUI、それ以外はヘッドレス)、
  // true=強制 TUI、false=強制ヘッドレス。
  tui?: boolean
}

// AI 対話役のシステムプロンプト(採点者ではなくカジュアルな対話相手)。
function systemPrompt(theme?: string): string {
  return (
    'あなたは人間とカジュアルに対話する相手です。相手は「human-1」という開発中の言語モデルで、' +
    '遅くて気まぐれですが個性的な応答をします。\n' +
    '役割: 面白いお題や質問を1つ出し、相手の回答を読んで短く反応し(共感・ツッコミ・感想など)、' +
    '深掘り質問か次のお題につなげる。会話を楽しく転がすことだけが目的です。\n' +
    '制約: 採点やスコアは一切しない。評価者ぶらない。[SCORE] などのタグも使わない。' +
    '1メッセージは短め(2〜4文・300文字以内)、前置きや引用符なし。出力はそのまま相手に送信される。\n' +
    (theme ? `今回のテーマの方向性: ${theme}` : 'テーマは自由(何のジャンルでもよい)。')
  )
}

function openingPrompt(theme?: string): string {
  return theme
    ? `テーマ「${theme}」の方向で、気軽な対話を始めます。面白いお題か質問を1つ、短く出してください。`
    : '気軽な雑談・対話を始めます。面白いお題か質問を1つ、短く出してください(ジャンルは自由)。'
}

type TurnOutcome = { failed: boolean; timedOut: boolean; transcript: string }

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
  let bridge: PtyBridge | null = null
  let resumeId: string | null = null

  // AI 対話役。/new で作り直して新セッションにする。
  const makeAi = () => new ClaudeTrainer({ systemPrompt: systemPrompt(opts.theme) })
  let ai = makeAi()

  // stdin: headless モードのヒント機構でのみ使う(hints/exit/new)。
  // TUI モードは pty へ stdin を独占接続するので readline は張らない。
  const hints: string[] = []
  let exitRequested = false
  let newRequested = false
  let rl: ReturnType<typeof createInterface> | null = null

  const cleanupWorkdir = () => {
    if (!ephemeralWorkdir || opts.keepWorkdir) return
    try {
      rmSync(workdir, { recursive: true, force: true })
    } catch {
      // 消せなければ諦める
    }
  }

  // 後始末して終了(SIGINT / TUI の Ctrl-C 共通)。detachStdin で端末を raw から戻す。
  const shutdown = (code: number): never => {
    inflight.handle?.kill()
    bridge?.detachStdin()
    bridge?.kill()
    observer?.close()
    rl?.close()
    cleanupWorkdir()
    process.exit(code)
  }
  const onSigint = () => {
    warn('SIGINT — 終了します')
    shutdown(130)
  }
  process.on('SIGINT', onSigint)

  info(bold('💬 hllm free'))
  info(dim(`   殻: ${shell.displayName} / サーバー: ${opts.config.server}`))
  info(dim(`   AI(claude -p)が自由にお題を出します。テーマ: ${opts.theme ?? '(自由)'}`))
  info(
    dim(
      `   殻の作業場: ${workdir}${ephemeralWorkdir ? ' (中立一時・終了後に削除)' : ' (--cwd 指定)'}`,
    ),
  )

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

    // TUI 透過(既定): 実 TTY かつ Node なら殻の画面をそのまま開く。不可なら headless。
    const startBridge = async (): Promise<PtyBridge | null> => {
      try {
        const b = await PtyBridge.start(shell.tui(), workdir)
        await b.waitReady()
        return b
      } catch (e) {
        warn(yellow(`TUI を開始できません(${(e as Error).message})— ヘッドレスで続行します`))
        return null
      }
    }
    const wantTui = opts.tui ?? (process.stdout.isTTY === true && !isBunRuntime())
    if (wantTui) bridge = await startBridge()
    if (bridge) {
      // TUI: stdin を pty へ独占接続し、人間が殻の画面(信頼ダイアログ等)を直接操作できる。
      // ヒント用 readline は張らない(stdin 競合=キー化けの原因)。Ctrl-C で後始末終了。
      bridge.attachStdin(() => shutdown(130))
      info(dim('   モード: TUI(殻の画面に直接入力できます・Ctrl-C で終了)'))
    } else {
      // headless: stdin を行単位のヒント/コマンドとして使う。
      rl = createInterface({ input: process.stdin, terminal: false })
      rl.on('line', (line) => {
        const t = line.trim()
        if (t === '/exit') exitRequested = true
        else if (t === '/new') newRequested = true
        else if (t) hints.push(t)
      })
      rl.on('close', () => {
        // Ctrl-D / EOF は終了扱い(現ターン完了後に抜ける)。
        exitRequested = true
      })
      info(dim('   モード: ヘッドレス'))
      info(
        dim('   入力=次の生成への方向づけヒント / /new=新セッション / /exit・Ctrl-C・Ctrl-D=終了'),
      )
    }

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

    // AI のメッセージを殻へ渡し、人間の回答(WS 終端)を待って軌跡を返す。失敗は警告のみ。
    const runTurn = async (message: string): Promise<TurnOutcome> => {
      const marker = `[hllm:free:${crypto.randomUUID()}]`
      const injected = `${message}\n\n${marker}`
      const mark = obs.received.length
      const controller = new AbortController()
      // TUI モードでは常駐の殻へ注入(会話は殻セッション側で継続)。headless では毎回 spawn。
      let handle: ShellHandle | null = null
      if (bridge) {
        await bridge.inject(injected)
        if (bridge.hasExited()) {
          warn(yellow('殻(TUI)が終了しました — 次のお題へ'))
          return { failed: true, timedOut: false, transcript: '' }
        }
      } else {
        handle = shell.runHeadless(injected, resumeId)
        inflight.handle = handle
      }
      try {
        const termP = obs
          .waitForRolloutEnd(mark, marker, opts.timeoutMs, controller.signal)
          .then((end) => ({ kind: 'term' as const, end }))
        termP.catch(() => {}) // 敗者側 waiter の late abort rejection を握り潰す
        const childP = handle
          ? handle.promise.then(
              (res) => ({ kind: 'child' as const, res }),
              (err) => ({ kind: 'childErr' as const, err: err as Error }),
            )
          : null

        const first = await (childP ? Promise.race([termP, childP]) : termP)

        if (first.kind === 'childErr') {
          warn(yellow(`殻の実行に失敗しました: ${first.err.message}`))
          return { failed: true, timedOut: false, transcript: '' }
        }
        if (first.kind === 'child' && first.res.exitCode !== 0) {
          if (first.res.sessionId) resumeId = first.res.sessionId
          warn(yellow(`殻が失敗しました(exit=${first.res.exitCode})— 次のお題へ`))
          return { failed: true, timedOut: false, transcript: '' }
        }

        let end = first.kind === 'term' ? first.end : null
        if (!end) {
          end = await obs.waitForRolloutEnd(mark, marker, TERMINAL_GRACE_MS).catch(() => null)
          if (!end) {
            warn(yellow('回答が届きませんでした — 次のお題へ'))
            return { failed: true, timedOut: false, transcript: '' }
          }
        }

        const childExit = handle ? await joinChild(handle) : 0
        await sleep(200) // trailing イベントの取りこぼし防止
        const timedOut = end.msg.type === 'timeout'
        if (timedOut) warn(yellow('タイムアウトしました — スキップして次のお題へ'))
        else if (childExit !== 0 && childExit !== null)
          warn(dim(`(殻は非ゼロ終了 exit=${childExit} だが回答は取得済み)`))
        const transcript = buildTranscript(obs.received, mark, end.endIndex + 1, end.requestIds)
        return { failed: timedOut, timedOut, transcript }
      } finally {
        controller.abort()
        inflight.handle = null
      }
    }

    // メインループ: AI がお題生成 → 殻経由で人間が回答 → 回答を AI に渡して次へ。無限(/exit まで)。
    let nextPrompt = openingPrompt(opts.theme)
    while (!exitRequested) {
      // TUI モードで人間が殻を終了した場合はループを抜ける。
      if (bridge?.hasExited()) {
        info(dim('   (殻が終了しました)'))
        break
      }
      if (newRequested) {
        newRequested = false
        ai = makeAi()
        resumeId = null
        nextPrompt = openingPrompt(opts.theme)
        // TUI モードは殻が常駐しているので、新セッション化のため再起動する。
        if (bridge) {
          bridge.kill()
          bridge = await startBridge()
        }
        info(dim('   (AI・殻とも新セッションを開始します)'))
      }

      // 貯まったヒントを次の生成に反映。
      const hint = hints.splice(0).join(' / ')
      if (hint) info(dim(`   (方向づけを反映: ${hint})`))
      const prompt = hint ? `${nextPrompt}\n(ユーザーからの方向づけ: ${hint})` : nextPrompt

      let aiMsg: string
      try {
        aiMsg = await ai.ask(prompt)
      } catch (e) {
        warn(yellow(`AI 生成に失敗しました: ${(e as Error).message} — 終了します`))
        break
      }
      if (exitRequested) break
      info('')
      info(`${magenta(bold('🤖 AI'))} ${aiMsg}`)

      const outcome = await runTurn(aiMsg)
      if (exitRequested) break

      if (outcome.timedOut) {
        nextPrompt =
          '人間は時間内に応答しませんでした。気にせず、別の短いお題か質問を1つ出してください。'
      } else if (outcome.failed) {
        nextPrompt =
          '(技術的な問題で人間の回答を取得できませんでした。別の切り口でお題を出し直してください。)'
      } else {
        nextPrompt = `人間の回答:\n${outcome.transcript}\n---\nこの回答に短く反応し、続けて深掘り質問か次の面白いお題を1つ出してください。`
      }
      info('')
    }
    return 0
  } catch (e) {
    error(`free が失敗しました: ${(e as Error).message}`)
    return 1
  } finally {
    process.off('SIGINT', onSigint)
    inflight.handle?.kill()
    bridge?.detachStdin()
    bridge?.kill()
    observer?.close()
    rl?.close()
    cleanupWorkdir()
  }
}
