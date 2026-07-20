// `hllm theater` — 観測モード(PoC theater.mjs / theater-claude.mjs 相当)。
// サーバーの WS を購読し、request / thought / tool_called / answered / timeout / score を
// ターミナルへ整形表示するだけ(出題や採点はしない)。

import type { Config } from './config'
import { bold, cyan, dim, info, warn } from './log'
import { renderEvent } from './transcript'
import { Observer } from './ws'

export type TheaterOptions = {
  config: Config
}

export async function runTheater(opts: TheaterOptions): Promise<void> {
  info(bold('🎭 hllm theater'))
  info(dim(`   サーバー: ${opts.config.server}`))
  info(dim('   WS を購読中… (Ctrl+C で終了)'))
  info('')

  const observer = new Observer({
    server: opts.config.server,
    token: opts.config.token,
    onStatus: (s) => {
      if (s === 'open') info(cyan('── WS 接続 ──'))
      else warn(dim(`WS: ${s}`))
    },
  })

  observer.subscribe((m) => {
    const line = renderEvent(m)
    if (line) info(line)
  })

  await observer.connect()

  // Ctrl+C まで常駐する。
  await new Promise<void>((resolve) => {
    const done = () => {
      observer.close()
      info('')
      info(dim('theater を終了しました。'))
      resolve()
    }
    process.on('SIGINT', done)
    process.on('SIGTERM', done)
  })
}
