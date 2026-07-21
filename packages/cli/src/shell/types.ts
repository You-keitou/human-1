// 殻(codex / claude)を train から共通に扱うためのインターフェース。
// 殻は「トレーナーの出題プロンプトを人間 LLM サーバーへの API リクエストに変換する導管」。
// 回答検出は殻の stdout ではなくサーバーの WS `answered` で行う(確定事項)。

import type { Config } from '../config'

export type ShellKind = 'codex' | 'claude'

export type ShellRunResult = {
  exitCode: number
  stdout: string
  stderr: string
  sessionId: string | null
}

// ヘッドレス起動のキャンセル可能ハンドル。promise は子の完了(exit / エラー)で解決し、
// kill() で in-flight の子を確実に落とせる。
export type ShellHandle = {
  promise: Promise<ShellRunResult>
  kill: () => void
}

// TUI 起動時のダイアログ自動応答ルール。画面に pattern が現れたら keys を送る。
// 殻ごとに複数種のダイアログ(更新確認・ディレクトリ信頼など)があるので配列で持つ。
export type TrustRule = { pattern: RegExp; keys: string }

export type TuiSpawn = {
  cmd: string
  args: string[]
  env: Record<string, string>
  trust: TrustRule[]
}

export interface Shell {
  readonly kind: ShellKind
  readonly displayName: string
  // 殻の設定(codex プロファイル書き出し等)。dry-run では書き込まず説明のみ返す。
  setup(dryRun: boolean): Promise<{ summary: string }>
  // 殻をヘッドレスで 1 回起動しプロンプトを投げる。継続に前回 sessionId を渡す。
  // 起動と同時にハンドルを返す(同期)。回答検出は WS 側が主シグナル。
  runHeadless(prompt: string, resumeId: string | null): ShellHandle
  // node-pty 経由の TUI 起動情報。
  tui(): TuiSpawn
}

export type ShellFactoryOptions = {
  config: Config
  // codex プロファイル名 / 作業ディレクトリ。
  profile: string
  cwd: string
  // 殻 1 回あたりのヘッドレス実行タイムアウト(ms)。人間は遅いので長め。
  timeoutMs: number
  // ヘッドレス実行中に殻の stdout を透過表示するか。
  echo: boolean
}
