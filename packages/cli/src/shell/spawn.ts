// 殻をヘッドレス起動して stdout/stderr を収集する共通ヘルパ。
// ランタイム非依存(Node 標準の node:child_process を使い、bun でも node でも動く)。
// 起動と同時にキャンセル可能なハンドル({ promise, kill })を返す。呼び出し側は
// promise を await して結果を得つつ、終了・エラー時に kill() で子を確実に落とせる。
// echo=true のときは stdout を親プロセスへも透過する(TUI ではなく素のパイプ表示)。

import { spawn } from 'node:child_process'

export type CaptureResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type SpawnHandle = {
  promise: Promise<CaptureResult>
  kill: () => void
}

export function spawnHandle(
  cmd: string[],
  env: Record<string, string>,
  cwd: string,
  timeoutMs: number,
  echo: boolean,
): SpawnHandle {
  const child = spawn(cmd[0] as string, cmd.slice(1), {
    cwd,
    env,
    // codex exec は stdin が開いていると `<stdin>` ブロックの追加入力を待つ。プロンプトは
    // 引数で渡すので stdin は閉じる(claude -p も引数プロンプトなので影響なし)。
    stdio: ['ignore', 'pipe', 'pipe'],
    // timeout 超過で killSignal を送って確実に落とす。
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  })

  const outChunks: Buffer[] = []
  const errChunks: Buffer[] = []
  child.stdout?.on('data', (d: Buffer) => {
    outChunks.push(d)
    if (echo) process.stdout.write(d)
  })
  child.stderr?.on('data', (d: Buffer) => {
    errChunks.push(d)
  })

  const promise = new Promise<CaptureResult>((resolve, reject) => {
    let settled = false
    child.on('error', (e) => {
      if (settled) return
      settled = true
      reject(e)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      resolve({
        // signal で殺された(timeout / kill)場合は code=null → 非ゼロ扱い。
        exitCode: code ?? (signal ? 1 : 0),
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
      })
    })
  })

  return {
    promise,
    kill: () => {
      try {
        child.kill('SIGKILL')
      } catch {
        // 既に終了していれば無視
      }
    },
  }
}
