// node-pty による殻 TUI の透過(ベストエフォート)。
//
// 重要な制約(検証済み): node-pty は Node では動くが、Bun 1.2 では pty の読み出しで
// ENXIO を起こし透過できない。hllm のシェバンは bun なので、TUI 透過は既定では無効。
// train は既定でヘッドレス(素のパイプ表示)で動作する。--tui は node ランタイム下でのみ
// 機能する実験的経路。ここでは動的 import で node-pty を遅延ロードし、
// 使えない場合は明確なエラーで倒す(無警告のフォールバックはしない)。

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

async function loadPty(): Promise<PtyModule> {
  if (isBunRuntime()) {
    throw new Error(
      'TUI 透過は Bun ランタイムでは node-pty の非互換(ENXIO)により使えません。' +
        'ヘッドレスモード(既定)を使うか、node で実行してください。',
    )
  }
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

  private constructor(private readonly spawnInfo: TuiSpawn) {}

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

  // 描画が落ち着く(出力が 2s 途切れる)まで待つ。信頼/更新ダイアログは自動応答する。
  async waitReady(maxMs = 30_000): Promise<void> {
    const begin = Date.now()
    while (Date.now() - begin < maxMs) {
      if (this.exited) throw new Error(`${this.spawnInfo.cmd} が起動直後に終了しました`)
      if (this.spawnInfo.trust.pattern.test(this.screen)) {
        this.screen = ''
        await sleep(300)
        this.proc?.write(this.spawnInfo.trust.keys)
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
