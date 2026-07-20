// 依存ゼロの軽量ロガー。TTY のときだけ ANSI 色を付ける(機能色は使わずシンプルに)。

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR

const wrap = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)

export const dim = wrap(2)
export const bold = wrap(1)
export const cyan = wrap(36)
export const green = wrap(32)
export const yellow = wrap(33)
export const red = wrap(31)
export const magenta = wrap(35)

export function info(msg: string): void {
  process.stdout.write(`${msg}\n`)
}

export function warn(msg: string): void {
  process.stderr.write(`${yellow('warn')} ${msg}\n`)
}

export function error(msg: string): void {
  process.stderr.write(`${red('error')} ${msg}\n`)
}
