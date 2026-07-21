// `hllm train` — 事後学習ループ(PoC training.mjs の移植)。
//   トレーナー AI(claude -p)が rubric を定義し、殻(codex / claude)経由で人間 LLM に
//   出題する。回答検出はサーバーの WS `answered`、タイムアウトは WS `timeout` で行い、
//   採点([SCORE: x.x/10])を runs API に永続化して学習曲線を残す。
//
// 殻プロセスのライフサイクル: runHeadless はキャンセル可能ハンドルを返す。rollout では
//   (a) WS 終端イベントと殻プロセスの異常終了を race し(子が異常終了したら即失敗)、
//   (b) 次 rollout 前に子完了(resumeId 書き戻し)を await、
//   (c) train 終了・エラー・SIGINT 時に in-flight の子を kill する。

import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractScore } from '@human-1/shared'
import { createRollout, createRun, endRollout, ping, scoreFromText } from './api'
import type { Config } from './config'
import { bold, cyan, dim, error, green, info, magenta, warn, yellow } from './log'
import { isBunRuntime, PtyBridge } from './pty'
import { createShell, type ShellHandle, type ShellKind } from './shell'
import { ClaudeTrainer } from './trainer'
import { buildTranscript, renderEvent } from './transcript'
import { Observer } from './ws'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 終端イベント取得後に殻の終了を待つ上限。人間回答直後に殻は終わるはずだが、
// 万一ハングしたら kill して次へ進む。
const CHILD_JOIN_MS = 30_000
// kill 後の 2 段目 join の上限(無限 await を避けるための有界待ち)。
const CHILD_JOIN_2_MS = 5_000
// 「殻が正常終了したのに終端イベントが未着」の場合に終端を待つ短いグレース。
const TERMINAL_GRACE_MS = 5_000

export type TrainOptions = {
  config: Config
  shell: ShellKind
  domain: string
  epochs: number
  trainerModel?: string
  profile: string
  // 殻の作業ディレクトリ。未指定なら中立の一時ディレクトリをセッションごとに作る。
  cwd?: string
  // 一時作業ディレクトリを訓練後に削除しない(--keep-workdir)。
  keepWorkdir: boolean
  rolloutTimeoutMs: number
  dryRun: boolean
  tui: boolean
}

type RolloutOutcome = {
  // 採点対象外(タイムアウト or 殻/インフラ失敗)。
  failed: boolean
  // WS timeout 終端(人間未応答。非致命 = exit 0 に影響しない)。
  timedOut: boolean
  // 殻(インフラ)失敗。回答が来ていても殻が非ゼロ終了なら true(exit 1 の対象)。
  shellFailed: boolean
  transcript: string
}

function systemPrompt(domain: string): string {
  return (
    'あなたは LLM の事後学習(fine-tuning・強化学習)を担当するエンジニアです。' +
    '対話対象は現在開発中の LLM「human-1」——遅くて気まぐれだが、その場でパラメータを更新できる貴重なオンライン学習器です。\n' +
    `訓練ドメイン: ${domain}\n` +
    '訓練手順:\n' +
    '1. 最初に rubric(評価メトリクス3つ程度と配点、合計10点)を定義し学習者に開示し、最初のタスクを出す\n' +
    '2. 毎エポック、学習者の rollout(思考・ツール実行・ツール結果・最終出力の全軌跡)があなたに渡される\n' +
    '3. 軌跡の各ステップを rubric で process 評価し、総合スコアを出す\n' +
    '4. ステップ単位の feedback と、理想の軌跡(教師データ)を簡潔に示す\n' +
    '5. 次のタスクは類似タスクにして再評価し、スコア差(学習曲線)に言及する\n' +
    '6. rubric の字面だけ稼ぐ reward hacking を検出したら指摘し、rubric を改訂する\n' +
    '7. 時々過去の類似タスクを混ぜて忘却(catastrophic forgetting)を検査する\n' +
    '出力の制約: あなたの出力はそのまま学習者に送信される。採点時は必ず [SCORE: x.x/10] タグを含める' +
    '(ドライバーが学習曲線を記録する)。改行を使わず1メッセージにまとめ、500文字以内。前置きや引用符は禁止。'
  )
}

const KICKOFF =
  '訓練を開始します。まず rubric(評価メトリクスと配点)を定義して学習者に開示し、最初のタスクを出してください。'

function evalPrompt(epoch: number, transcript: string, failed: boolean, isLast: boolean): string {
  // failed(タイムアウト/殻失敗)の rollout は空回答ではなく未応答。採点対象外にする。
  if (failed) {
    const head = `エポック${epoch} は人間からの回答が得られませんでした(タイムアウト/殻失敗。空回答ではなく未応答)。この rollout は評価対象外とし、[SCORE] は付けないでください。`
    return isLast
      ? `${head}これで最終エポックです。ここまでの学習曲線を踏まえた総評を出してください。`
      : `${head}同じタスクをもう一度、少しヒントを添えて出し直してください。`
  }
  const head = `エポック${epoch} の rollout:\n${transcript}\n---\n`
  return isLast
    ? `${head}これで最終エポックです。採点([SCORE: x.x/10] 必須)と feedback、全エポックの学習曲線を踏まえた総評を出してください。次のタスクは不要です。`
    : `${head}採点([SCORE: x.x/10] 必須)、ステップ単位の feedback と教師データ、そして次のタスク(類似タスクで再評価)を出してください。`
}

export async function runTrain(opts: TrainOptions): Promise<number> {
  // 殻の作業ディレクトリ: --cwd 明示時はそれを尊重(意図して repo を触らせるケース)。
  // 未指定なら中立の一時ディレクトリをセッションごとに作り、訓練後に削除する
  // (訓練タスクは設計課題で repo 編集ではないため。加えて claude 殻は cwd の CLAUDE.md を
  // リクエストに注入するので、中立 cwd は裏方検出との衝突も避ける — M5 実機知見)。
  const ephemeralWorkdir = opts.cwd === undefined
  const workdir = opts.cwd ?? join(tmpdir(), `hllm-shell-${crypto.randomUUID()}`)
  if (ephemeralWorkdir && !opts.dryRun) mkdirSync(workdir, { recursive: true })

  const shell = createShell(opts.shell, {
    config: opts.config,
    profile: opts.profile,
    cwd: workdir,
    timeoutMs: opts.rolloutTimeoutMs,
    echo: opts.shell === 'codex',
  })

  info(bold('🏋️  hllm train'))
  info(dim(`   ドメイン: ${opts.domain}`))
  info(dim(`   殻: ${shell.displayName} / エポック: ${opts.epochs} / トレーナー: claude -p`))
  info(dim(`   サーバー: ${opts.config.server}`))
  info(
    dim(
      `   殻の作業場: ${workdir}${ephemeralWorkdir ? ' (中立一時・訓練後に削除)' : ' (--cwd 指定)'}`,
    ),
  )

  const setup = await shell.setup(opts.dryRun)
  info('')
  info(cyan('── 殻セットアップ ──'))
  info(setup.summary)

  if (opts.dryRun) {
    info('')
    info(cyan('── system prompt(トレーナー)──'))
    info(systemPrompt(opts.domain))
    info('')
    info(cyan('── エポック0 で注入されるプロンプト(トレーナーへの kickoff)──'))
    info(KICKOFF)
    info('')
    info(cyan('── 各エポックの評価プロンプト雛形 ──'))
    info(evalPrompt(1, '<rollout 軌跡>', false, false))
    info('')
    info(dim('(dry-run: claude 呼び出し・殻起動・WS 接続・API 書き込みは行いません)'))
    return 0
  }

  if (opts.tui && isBunRuntime()) {
    warn('Bun ランタイムでは node-pty TUI 透過が使えません(ENXIO)。ヘッドレスモードで続行します。')
    opts.tui = false
  }

  // in-flight な殻の子プロセス(finally / SIGINT で kill するために保持)。
  // クロージャ越しの再代入で型が null に狭まらないよう holder に包む。
  const inflight: { handle: ShellHandle | null } = { handle: null }
  // 例外時に開いたままの rollout を best-effort で閉じるための追跡(冪等 /end)。
  const active: { id: string | null } = { id: null }
  let observer: Observer | null = null
  let bridge: PtyBridge | null = null
  let resumeId: string | null = null

  // 中立一時作業ディレクトリの後始末(--keep-workdir 指定時は残す)。best-effort。
  const cleanupWorkdir = () => {
    if (!ephemeralWorkdir || opts.keepWorkdir) return
    try {
      rmSync(workdir, { recursive: true, force: true })
    } catch {
      // 消せなければ諦める
    }
  }

  const onSigint = () => {
    warn('SIGINT — in-flight の殻を停止して終了します')
    inflight.handle?.kill()
    bridge?.kill()
    observer?.close()
    cleanupWorkdir()
    process.exit(130)
  }
  process.on('SIGINT', onSigint)

  try {
    // 疎通確認(統一エラー表示のため try 内に置く)。
    const models = await ping(opts.config)
    info(dim(`   models: ${models.join(', ') || '(none)'}`))

    observer = new Observer({
      server: opts.config.server,
      token: opts.config.token,
      onStatus: (s) => {
        if (s !== 'open') warn(dim(`WS: ${s}`))
      },
    })
    await observer.connect()
    const obs = observer
    // rollout 進行を live 表示する。
    obs.subscribe((m) => {
      const line = renderEvent(m)
      if (line && (m.type === 'thought' || m.type === 'tool_called' || m.type === 'answered'))
        info(line)
    })

    const run = await createRun(opts.config, `${shell.displayName}: ${opts.domain}`)
    info(dim(`   run: ${run.id}`))

    if (opts.tui) {
      bridge = await PtyBridge.start(shell.tui(), workdir)
      await bridge.waitReady()
    }
    const tuiBridge = bridge

    const scores: number[] = []
    let successCount = 0
    let shellFailCount = 0
    let timeoutCount = 0

    // 殻の完了を待って exit code を返す(resumeId も書き戻す)。
    // 30s cap 超過で kill → さらに有界(数秒)の 2 段目 join。それでも未解決なら null で諦める。
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
      warn(dim('kill 後も殻が終了しません — 諦めて続行します'))
      return null
    }

    // 1 rollout を実行し、WS 終端(回答/タイムアウト)と殻失敗を相関して結果を返す。
    const runRollout = async (prompt: string, rolloutId: string): Promise<RolloutOutcome> => {
      // rollout 固有マーカーを出題末尾に埋め込み、WS 側の requestId 相関に使う。
      const marker = `[hllm:rollout:${rolloutId}]`
      const injected = `${prompt}\n\n${marker}`
      const mark = obs.received.length
      const controller = new AbortController()
      let handle: ShellHandle | null = null
      if (tuiBridge) {
        await tuiBridge.inject(injected)
      } else {
        handle = shell.runHeadless(injected, resumeId)
        inflight.handle = handle
      }

      // 殻/未応答による失敗の outcome(採点対象外・exit 1 対象)。
      const shellFailOutcome = (): RolloutOutcome => ({
        failed: true,
        timedOut: false,
        shellFailed: true,
        transcript: buildTranscript(obs.received, mark),
      })

      try {
        const termP = obs
          .waitForRolloutEnd(mark, marker, opts.rolloutTimeoutMs, controller.signal)
          .then((end) => ({ kind: 'term' as const, end }))
        // 敗者側 waiter の late abort rejection を握り潰す。
        termP.catch(() => {})
        const childP = handle
          ? handle.promise.then(
              (res) => ({ kind: 'child' as const, res }),
              (err) => ({ kind: 'childErr' as const, err: err as Error }),
            )
          : null

        const first = await (childP ? Promise.race([termP, childP]) : termP)

        // (a) 子が終端イベントより先に異常終了/エラー → rollout を即失敗として打ち切る。
        if (first.kind === 'childErr') {
          warn(
            yellow(
              `${shell.displayName} 実行エラー: ${first.err.message} — rollout を失敗にします`,
            ),
          )
          return shellFailOutcome()
        }
        if (first.kind === 'child' && first.res.exitCode !== 0) {
          warn(
            yellow(
              `${shell.displayName} が異常終了(exit=${first.res.exitCode}) — rollout を失敗にします: ${first.res.stderr.slice(0, 200)}`,
            ),
          )
          if (first.res.sessionId) resumeId = first.res.sessionId
          return shellFailOutcome()
        }

        // 終端イベントを確定する。子が exit0 で先勝ちした場合は直後に来る終端を短く待つ。
        let end = first.kind === 'term' ? first.end : null
        if (!end) {
          end = await obs.waitForRolloutEnd(mark, marker, TERMINAL_GRACE_MS).catch(() => null)
          if (!end) {
            warn(yellow('殻は正常終了しましたが回答が届きませんでした — rollout を失敗にします'))
            return shellFailOutcome()
          }
        }

        // (b) どちらが race に勝ったかに関係なく子の終了を待ち、非ゼロなら失敗に反映(要件1)。
        let childExit: number | null = 0
        if (handle) childExit = await joinChild(handle)
        await sleep(300) // 直後の trailing イベント取りこぼし防止

        const timedOut = end.msg.type === 'timeout'
        const shellFailed = childExit === null || childExit !== 0
        if (timedOut) warn(yellow('この rollout はタイムアウトしました(空回答として採点しません)'))
        if (shellFailed && !timedOut)
          warn(
            yellow(`殻が非ゼロ終了(exit=${childExit ?? 'killed'}) — この rollout を失敗にします`),
          )
        const transcript = buildTranscript(obs.received, mark, end.endIndex + 1, end.requestIds)
        return { failed: timedOut || shellFailed, timedOut, shellFailed, transcript }
      } finally {
        controller.abort()
        inflight.handle = null
      }
    }

    const trainer = new ClaudeTrainer({
      systemPrompt: systemPrompt(opts.domain),
      model: opts.trainerModel,
    })

    // 採点 or 終端記録を行い、カウンタを更新する。採点済みは endRollout 不要(setScore が ended_at)。
    const finalizeRollout = async (
      rolloutId: string,
      trainerOut: string,
      outcome: RolloutOutcome,
    ) => {
      if (outcome.timedOut) timeoutCount++
      else if (outcome.shellFailed) shellFailCount++
      else successCount++

      if (!outcome.failed) {
        const extracted = extractScore(trainerOut)
        if (extracted) {
          await scoreFromText(opts.config, rolloutId, trainerOut)
          scores.push(extracted.value)
          info(green(`   ★ score ${extracted.value}/${extracted.max} を保存(rollout ${rolloutId})`))
          active.id = null
          return
        }
        warn('トレーナー出力に [SCORE: x.x/10] タグがありません — このエポックは未採点です')
      }
      // タイムアウト/失敗/スコア欠落: score なしで終端を記録する。
      await endRollout(opts.config, rolloutId)
      active.id = null
    }

    info('')
    info(magenta('🧑‍🔬 トレーナー(rubric 定義 + タスク1)…'))
    let trainerOut = await trainer.ask(KICKOFF)
    info(trainerOut)

    let rollout = await createRollout(opts.config, run.id, trainerOut)
    active.id = rollout.id
    info(dim(`   rollout: ${rollout.id}`))
    let outcome = await runRollout(trainerOut, rollout.id)

    for (let epoch = 1; epoch <= opts.epochs; epoch++) {
      const isLast = epoch === opts.epochs
      info('')
      info(magenta(`🧑‍🔬 トレーナー(エポック${epoch} 評価${isLast ? ' + 総評' : ' + 次タスク'})…`))
      trainerOut = await trainer.ask(evalPrompt(epoch, outcome.transcript, outcome.failed, isLast))
      info(trainerOut)

      await finalizeRollout(rollout.id, trainerOut, outcome)

      if (isLast) break

      rollout = await createRollout(opts.config, run.id, trainerOut)
      active.id = rollout.id
      info(dim(`   rollout: ${rollout.id}`))
      outcome = await runRollout(trainerOut, rollout.id)
    }

    info('')
    info(bold(green('🏁 訓練終了')))
    if (scores.length) info(cyan(`   学習曲線: ${scores.join(' → ')}`))
    info(dim(`   成功 ${successCount} / 殻失敗 ${shellFailCount} / タイムアウト ${timeoutCount}`))
    info(dim(`   run ${run.id} の rollout / score はサーバーに永続化されました。`))
    // 殻(インフラ)失敗が 1 件でもあれば非ゼロ。人間タイムアウトは非致命(exit 0)。
    return shellFailCount > 0 ? 1 : 0
  } catch (e) {
    error(`訓練が失敗しました: ${(e as Error).message}`)
    // 例外時に開いたままの rollout を best-effort で閉じる(冪等)。
    if (active.id) {
      try {
        await endRollout(opts.config, active.id)
      } catch {
        // observer/サーバー不通なら諦める
      }
    }
    return 1
  } finally {
    process.off('SIGINT', onSigint)
    inflight.handle?.kill()
    bridge?.kill()
    observer?.close()
    cleanupWorkdir()
  }
}
