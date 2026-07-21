// node-pty による殻 TUI の透過。
//
// ランタイム方針(監督者決定): CLI は常に Node で動かし、node-pty で TUI を透過する。
// node-pty は Node v24 で動作実証済み。Bun では(1.3 で posix_spawnp は解消したが)pty の
// データが流れないため使えない — 万一 Bun 下で呼ばれたら明確なエラーで倒し、呼び出し側は
// ヘッドレスへ graceful fallback する。node-pty は optionalDependency。macOS の prebuild
// spawn-helper は chmod/quarantine 対処が要ることがあるので start 時に自動修復する。

import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { TuiSpawn } from './shell/types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// node-pty の最小型(依存を型に漏らさないため any 境界をここに閉じ込める)。
type PtyProcess = {
  onData: (cb: (data: string) => void) => void
  onExit: (cb: (e: { exitCode: number }) => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
}
type PtyModule = {
  spawn: (
    file: string,
    args: string[],
    opts: {
      name: string
      cols: number
      rows: number
      cwd: string
      env: Record<string, string>
    },
  ) => PtyProcess
}

export function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
}

// prebuild の spawn-helper に実行権限が無い / quarantine が付いていると spawn に失敗するので
// start 前に best-effort で修復する(M4 知見)。
function ensurePtyHelper(): void {
  try {
    const require = createRequire(import.meta.url)
    const root = dirname(require.resolve('node-pty/package.json'))
    const helper = join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
    if (!existsSync(helper)) return
    try {
      chmodSync(helper, 0o755)
    } catch {
      // 権限変更できなくても続行
    }
    if (process.platform === 'darwin') {
      try {
        execFileSync('xattr', ['-d', 'com.apple.quarantine', helper], { stdio: 'ignore' })
      } catch {
        // quarantine 属性が無ければ失敗するが問題ない
      }
    }
  } catch {
    // node-pty の場所が解決できなければ何もしない(import 側でエラーになる)
  }
}

async function loadPty(): Promise<PtyModule> {
  if (isBunRuntime()) {
    throw new Error(
      'TUI 透過は Bun ランタイムでは node-pty のデータ透過不可のため使えません。' +
        'CLI を Node で実行してください(bin/hllm は node を使います)。',
    )
  }
  ensurePtyHelper()
  try {
    return (await import('node-pty')) as unknown as PtyModule
  } catch (e) {
    throw new Error(`node-pty をロードできません: ${(e as Error).message}`)
  }
}

// TUI を起動し、透過表示しながらプロンプト注入できるブリッジ。
export class PtyBridge {
  private proc: PtyProcess | null = null
  private screen = ''
  private exited = false
  private sawOutput = false
  private lastDataAt = 0
  private readonly spawnInfo: TuiSpawn

  private constructor(spawnInfo: TuiSpawn) {
    this.spawnInfo = spawnInfo
  }

  static async start(spawnInfo: TuiSpawn, cwd: string): Promise<PtyBridge> {
    const pty = await loadPty()
    const bridge = new PtyBridge(spawnInfo)
    const proc = pty.spawn(spawnInfo.cmd, spawnInfo.args, {
      name: 'xterm-256color',
      cols: process.stdout.columns || 120,
      rows: process.stdout.rows || 36,
      cwd,
      env: spawnInfo.env,
    })
    bridge.proc = proc
    proc.onData((d) => {
      bridge.sawOutput = true
      bridge.lastDataAt = Date.now()
      bridge.screen = (bridge.screen + d).slice(-8000)
      process.stdout.write(d)
    })
    proc.onExit(() => {
      bridge.exited = true
    })
    return bridge
  }

  hasExited(): boolean {
    return this.exited
  }

  // 現在の画面バッファ(検証・デバッグ用)。
  screenBuffer(): string {
    return this.screen
  }

  // 描画が落ち着く(出力が 2s 途切れる)まで待つ。信頼/更新ダイアログは自動応答する。
  async waitReady(maxMs = 30_000): Promise<void> {
    const begin = Date.now()
    while (Date.now() - begin < maxMs) {
      if (this.exited) throw new Error(`${this.spawnInfo.cmd} が起動直後に終了しました`)
      const rule = this.spawnInfo.trust.find((r) => r.pattern.test(this.screen))
      if (rule) {
        this.screen = ''
        await sleep(300)
        this.proc?.write(rule.keys)
        await sleep(1000)
        continue
      }
      if (this.sawOutput && Date.now() - begin > 4000 && Date.now() - this.lastDataAt > 2000) return
      await sleep(300)
    }
  }

  async inject(text: string): Promise<void> {
    const line = text.replace(/\s+/g, ' ').trim()
    this.proc?.write(line)
    await sleep(600)
    this.proc?.write('\r')
  }

  kill(): void {
    try {
      this.proc?.kill()
    } catch {
      // 既に終了していれば無視
    }
  }
}
