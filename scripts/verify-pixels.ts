#!/usr/bin/env bun
// M3 で実装する UI が Pencil モック(design/reference/<screen>.png)と px 単位で一致するかを検証する。
//
// 仕組み: 設定(scripts/pixel-targets.json)に列挙した route を、基準画像と同じ
// deviceScaleFactor で Playwright(chromium)スクリーンショットし、pixelmatch で比較する。
// 差分 px 数・差分率を報告し、閾値超過で exit 1。差分画像は artifacts/pixel-diff/ に出力。
//
// 既定は strict: 設定した screen の基準画像が 1 枚でも欠けていれば FAIL(exit 1)。
// 基準がまだ無い立ち上げ期は --allow-missing を渡すと、欠けを SKIP 扱いにして exit 0 にする
// (基準が 1 枚も無ければ全 SKIP・exit 0)。生成手順は docs/testing.md 参照。

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

type Target = {
  screen: string
  route: string
  width: number
  height: number
}

type Config = {
  port: number
  referenceDir: string
  artifactsDir: string
  deviceScaleFactor: number
  threshold: number
  maxDiffRatio: number
  targets: Target[]
}

type Args = {
  configPath: string
  allowMissing: boolean
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// packages/ui/index.html に埋めたアプリ固有マーカー。別プロセスのサーバーを誤認しないための照合に使う。
const APP_MARKERS = ['name="app"', 'human-1']

function parseArgs(): Args {
  let allowMissing = false
  let configArg: string | undefined
  for (const a of process.argv.slice(2)) {
    if (a === '--allow-missing') allowMissing = true
    else if (!a.startsWith('--') && configArg === undefined) configArg = a
  }
  return {
    configPath: resolve(repoRoot, configArg ?? 'scripts/pixel-targets.json'),
    allowMissing,
  }
}

async function loadConfig(configPath: string): Promise<Config> {
  return JSON.parse(await readFile(configPath, 'utf8')) as Config
}

// HTTP を完了しないリスナーでハングしないよう、probe / readiness の fetch には短いタイムアウトを付ける。
const FETCH_TIMEOUT_MS = 2000

// 指定 URL に何か応答するプロセスがいるか(status を問わず、fetch が解決すれば占有とみなす)。
async function isPortResponding(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    return true
  } catch {
    return false
  }
}

// packages/ui の Vite dev サーバーを起動し、アプリ固有マーカーが返るまで待つ。
// (1) spawn 前にポートを probe し、既に応答があれば別プロセスの占有として明示 fail する。
// (2) readiness 待ちは boolean フラグではなく、子プロセスの exited と readiness を直接
//     Promise.race し、子が先に死んだら stderr を添えて即 fail する。
async function startServer(port: number): Promise<() => void> {
  const baseUrl = `http://localhost:${port}`

  if (await isPortResponding(baseUrl)) {
    throw new Error(
      `ポート ${port} は既に別プロセスが応答しています — readiness を誤認しないため中止します(占有プロセスを止めてください)`,
    )
  }

  const proc = Bun.spawn(['bun', 'run', 'dev', '--', '--port', String(port), '--strictPort'], {
    cwd: join(repoRoot, 'packages/ui'),
    stdout: 'ignore',
    stderr: 'pipe',
  })

  // stderr を捨てず溜める(起動失敗時に表示する)。
  let stderrText = ''
  const stderrDone = (async () => {
    const stream = proc.stderr as ReadableStream<Uint8Array> | undefined
    if (!stream) return
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) stderrText += decoder.decode(value)
    }
  })()

  let stopped = false
  const stop = (): void => {
    stopped = true
    proc.kill()
  }

  const readiness = (async (): Promise<() => void> => {
    const deadline = Date.now() + 30_000
    while (!stopped && Date.now() < deadline) {
      try {
        const res = await fetch(baseUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        if (res.ok) {
          const body = await res.text()
          // 応答はあるがマーカーが無い = 別プロセスのサーバーの可能性。まだビルド中かもしれず待機継続。
          if (APP_MARKERS.every((mark) => body.includes(mark))) return stop
        }
      } catch {
        // まだ立ち上がっていない
      }
      await Bun.sleep(200)
    }
    throw new Error(`Vite dev server が ${baseUrl} で起動しませんでした(タイムアウト)`)
  })()

  const exitGuard: Promise<() => void> = proc.exited.then((code) => {
    throw new Error(`Vite dev server プロセスが起動前に終了しました(exit ${code})`)
  })
  // race の勝敗が決まった後、負け側が後発で reject しても未処理にならないよう保険をかける。
  readiness.catch(() => {})
  exitGuard.catch(() => {})

  try {
    return await Promise.race([readiness, exitGuard])
  } catch (err) {
    stop()
    await stderrDone.catch(() => {})
    const tail = stderrText.trim()
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(tail ? `${msg}\n--- Vite stderr ---\n${tail}` : msg)
  }
}

type Outcome =
  | { screen: string; status: 'pass'; diffPixels: number; diffRatio: number; total: number }
  | { screen: string; status: 'fail'; reason: string; diffPixels?: number; diffRatio?: number }

async function compareTarget(
  page: import('@playwright/test').Page,
  baseUrl: string,
  target: Target,
  config: Config,
  refPath: string,
): Promise<Outcome> {
  await page.setViewportSize({ width: target.width, height: target.height })
  await page.goto(`${baseUrl}${target.route}`, { waitUntil: 'networkidle' })

  const shotBuf = await page.screenshot()
  const actual = PNG.sync.read(Buffer.from(shotBuf))
  const reference = PNG.sync.read(await readFile(refPath))

  if (actual.width !== reference.width || actual.height !== reference.height) {
    return {
      screen: target.screen,
      status: 'fail',
      reason: `寸法不一致: 基準 ${reference.width}x${reference.height} / 実測 ${actual.width}x${actual.height}(deviceScaleFactor と基準画像のスケールを揃えてください)`,
    }
  }

  const { width, height } = reference
  const diff = new PNG({ width, height })
  const diffPixels = pixelmatch(actual.data, reference.data, diff.data, width, height, {
    threshold: config.threshold,
  })
  const total = width * height
  const diffRatio = diffPixels / total

  const diffPath = join(resolve(repoRoot, config.artifactsDir), `${target.screen}.diff.png`)
  await writeFile(diffPath, PNG.sync.write(diff))
  await writeFile(
    join(resolve(repoRoot, config.artifactsDir), `${target.screen}.actual.png`),
    PNG.sync.write(actual),
  )

  if (diffRatio > config.maxDiffRatio) {
    return {
      screen: target.screen,
      status: 'fail',
      reason: `差分率 ${(diffRatio * 100).toFixed(3)}% が閾値 ${(config.maxDiffRatio * 100).toFixed(3)}% を超過`,
      diffPixels,
      diffRatio,
    }
  }
  return { screen: target.screen, status: 'pass', diffPixels, diffRatio, total }
}

async function main() {
  const { configPath, allowMissing } = parseArgs()
  const config = await loadConfig(configPath)
  const referenceDir = resolve(repoRoot, config.referenceDir)

  console.log(`px 検証: ${configPath}${allowMissing ? '  (--allow-missing)' : '  (strict)'}`)
  console.log(`基準ディレクトリ: ${referenceDir}\n`)

  const present: Target[] = []
  const missing: Target[] = []
  for (const t of config.targets) {
    const refPath = join(referenceDir, `${t.screen}.png`)
    ;(existsSync(refPath) ? present : missing).push(t)
  }

  // strict(既定): 基準が 1 枚でも欠けていれば FAIL。--allow-missing 指定時のみ SKIP 扱い。
  if (missing.length > 0 && !allowMissing) {
    console.error('FAIL(基準未生成): 以下の画面の基準画像がありません(strict モード)。')
    for (const t of missing) {
      console.error(`  欠落 ${t.screen}: ${config.referenceDir}/${t.screen}.png`)
    }
    console.error('  基準を生成する手順は docs/testing.md を参照。')
    console.error(
      '  立ち上げ期に赤くしたくない場合は --allow-missing(verify:pixels:bootstrap)を使う。',
    )
    process.exit(1)
  }

  if (present.length === 0) {
    console.log('SKIP(基準未生成): 比較対象の基準画像が 1 枚もありません。')
    console.log('  未生成の画面:', config.targets.map((t) => t.screen).join(', '))
    console.log('  生成手順は docs/testing.md を参照(Pencil で human-1.pen を開き export)。')
    process.exit(0)
  }

  await mkdir(resolve(repoRoot, config.artifactsDir), { recursive: true })

  const stop = await startServer(config.port)
  const baseUrl = `http://localhost:${config.port}`
  const outcomes: Outcome[] = []
  // chromium.launch() も try/finally 内に置き、launch 失敗時も Vite を確実に止める。
  try {
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext({ deviceScaleFactor: config.deviceScaleFactor })
      const page = await context.newPage()
      for (const t of present) {
        const refPath = join(referenceDir, `${t.screen}.png`)
        outcomes.push(await compareTarget(page, baseUrl, t, config, refPath))
      }
    } finally {
      await browser.close()
    }
  } finally {
    stop()
  }

  console.log('結果:')
  for (const o of outcomes) {
    if (o.status === 'pass') {
      console.log(
        `  PASS ${o.screen}: 差分 ${o.diffPixels}px / ${o.total}px (${(o.diffRatio * 100).toFixed(3)}%)`,
      )
    } else {
      console.log(`  FAIL ${o.screen}: ${o.reason}`)
    }
  }
  for (const t of missing) {
    console.log(`  SKIP ${t.screen}: 基準画像なし(${config.referenceDir}/${t.screen}.png)`)
  }

  const failed = outcomes.filter((o) => o.status === 'fail')
  console.log(
    `\n比較 ${outcomes.length} / SKIP ${missing.length} / FAIL ${failed.length}`,
    `(差分画像: ${config.artifactsDir}/)`,
  )
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('px 検証でエラー:', err)
  process.exit(1)
})
