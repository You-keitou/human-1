// 殻ファクトリ。--shell フラグから codex / claude の Shell を生成する。

import { ClaudeShell } from './claude'
import { CodexShell } from './codex'
import type { Shell, ShellFactoryOptions, ShellKind } from './types'

export type { Shell, ShellHandle, ShellKind, ShellRunResult, TuiSpawn } from './types'

export function createShell(kind: ShellKind, opts: ShellFactoryOptions): Shell {
  return kind === 'codex' ? new CodexShell(opts) : new ClaudeShell(opts)
}

export function isShellKind(v: string): v is ShellKind {
  return v === 'codex' || v === 'claude'
}
