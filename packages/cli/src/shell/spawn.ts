// 殻をヘッドレス起動して stdout/stderr を収集する共通ヘルパ。
// 起動と同時にキャンセル可能なハンドル({ promise, kill })を返す。呼び出し側は
// promise を await して結果を得つつ、終了・エラー時に kill() で子を確実に落とせる。
// echo=true のときは stdout を親プロセスへも透過する(TUI ではなく素のパイプ表示)。

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
  const proc = Bun.spawn(cmd, {
    cwd,
    env,
    // codex exec は stdin が開いていると `<stdin>` ブロックの追加入力を待つ。プロンプトは
    // 引数で渡すので stdin は閉じる(claude -p も引数プロンプトなので影響なし)。
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: timeoutMs,
  })

  const readAll = async (stream: ReadableStream<Uint8Array>, tee: boolean): Promise<string> => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let out = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      out += chunk
      if (tee) process.stdout.write(chunk)
    }
    return out
  }

  const promise = (async (): Promise<CaptureResult> => {
    const [stdout, stderr, exitCode] = await Promise.all([
      readAll(proc.stdout, echo),
      readAll(proc.stderr, false),
      proc.exited,
    ])
    return { exitCode, stdout, stderr }
  })()

  return {
    promise,
    kill: () => {
      try {
        proc.kill()
      } catch {
        // 既に終了していれば無視
      }
    },
  }
}
