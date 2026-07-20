#!/usr/bin/env bun
// 基準 PNG(design/reference/<screen>.png)を「Pencil 忠実 HTML の Chromium 描画」から生成する。
//
// 背景: Pencil 自身のキャンバス描画を撮った PNG を基準にすると、検証側(Chromium スクショ)との
// テキストラスタライズ差だけで数 % 残り 1% ゲートに届かない(実装品質でなくエンジン差)。
// そこで基準を「Pencil が export した忠実 HTML を、検証と同じ Chromium・同じ deviceScaleFactor で
// 描画したスクショ」に置き換える。検証(verify-pixels.ts)とレンダラが同一になるので、実装と
// デザインの真のレイアウト差だけが diff に残る。
//
// 決定性のための 3 点:
//   1. フォント同一性: Pencil HTML は Google Fonts(Fraunces / Inter / JetBrains Mono)を参照するが、
//      アプリは @fontsource-variable の woff2 を使う。glyph 差とネットワーク依存を消すため、
//      export 時に font 参照をアプリと同一の woff2(design/reference/html/fonts/ にローカル複製)へ
//      差し替える。ローカル資産は node_modules/@fontsource-variable から毎回再生成する(再現性)。
//   2. font-smoothing 同一性: アプリ base.css は -webkit-font-smoothing: antialiased を明示するが、
//      Pencil HTML は未指定(macOS 既定 = subpixel)。同じ正規化 style を export 時に注入する。
//   3. 白背景合成: モバイルは角丸(radius 28)で四隅が透過する。ページ背景 = 白の既定で撮り、
//      四隅を白合成する(基準・検証ともに同一エンジンなので一致する)。
//
// 使い方: bun run refs:generate  (= bun run scripts/export-references.ts)
// 生成手順の全体像は docs/testing.md 参照。

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type Target = { screen: string; width: number; height: number }
type Config = {
  referenceDir: string
  deviceScaleFactor: number
  targets: Target[]
}

const HTML_DIR = join(repoRoot, 'design/reference/html')
const FONTS_DIR = join(HTML_DIR, 'fonts')
const FONTS_FILES_DIR = join(FONTS_DIR, 'files')
const FONT_SOURCE_DIR = join(repoRoot, 'node_modules/@fontsource-variable')

// アプリ(packages/ui/src/main.tsx)が import する fontsource CSS と一対一。基準もこれと同一の
// woff2 で描く。'<X> Variable' → '<X>'(Pencil HTML の font-family 文字列)へ改名して束ねる。
const FONT_CSS_IMPORTS = [
  'fraunces/index.css',
  'fraunces/opsz-italic.css',
  'inter/index.css',
  'inter/standard-italic.css',
  'jetbrains-mono/index.css',
  'jetbrains-mono/wght-italic.css',
]
const FAMILY_RENAMES: Array<[string, string]> = [
  ["'Fraunces Variable'", "'Fraunces'"],
  ["'Inter Variable'", "'Inter'"],
  ["'JetBrains Mono Variable'", "'JetBrains Mono'"],
]

// アプリ base.css と同一のラスタライズ設定(§決定性 2)。
const NORMALIZE_STYLE =
  '<style>html,body{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}</style>'

// ローカル fonts.css が登録する family(§決定性 1 で '<X> Variable' → '<X>' に改名済み)。
const REF_FONT_FAMILIES = ['Fraunces', 'Inter', 'JetBrains Mono']

// 指定 family が document.fonts に「loaded」な FontFace として存在することを確認する。
// 1 つでも欠ければ throw(サイレント fallback で基準を system フォントで焼く事故を防ぐ)。
async function assertFontsLoaded(
  page: import('@playwright/test').Page,
  families: string[],
): Promise<void> {
  const missing = await page.evaluate(async (fams: string[]) => {
    await document.fonts.ready
    const bad: string[] = []
    for (const fam of fams) {
      try {
        await document.fonts.load(`16px "${fam}"`)
      } catch {
        // load 失敗はそのまま未ロード扱い
      }
      let ok = false
      for (const ff of document.fonts) {
        const name = ff.family.replace(/^["']|["']$/g, '')
        if (name === fam && ff.status === 'loaded') {
          ok = true
          break
        }
      }
      if (!ok) bad.push(fam)
    }
    return bad
  }, families)
  if (missing.length > 0) {
    throw new Error(
      `基準フォント未ロード: ${missing.join(', ')} — ローカル fonts.css / woff2 の解決を確認してください`,
    )
  }
}

async function loadConfig(): Promise<Config> {
  const path = join(repoRoot, 'scripts/pixel-targets.json')
  return JSON.parse(await readFile(path, 'utf8')) as Config
}

// fontsource の CSS を束ね、family を改名し、参照 woff2 を design/reference/html/fonts/ に複製する。
// 生成物: fonts/fonts.css(@font-face 群)と fonts/files/*.woff2。冪等(毎回作り直す)。
async function buildLocalFonts(): Promise<void> {
  if (!existsSync(FONT_SOURCE_DIR)) {
    throw new Error(
      `@fontsource-variable が見つかりません(${FONT_SOURCE_DIR})。bun install を実行してください。`,
    )
  }
  await rm(FONTS_DIR, { recursive: true, force: true })
  await mkdir(FONTS_FILES_DIR, { recursive: true })

  const cssParts: string[] = []
  const woff2: Set<string> = new Set()
  for (const rel of FONT_CSS_IMPORTS) {
    const srcCss = join(FONT_SOURCE_DIR, rel)
    let css = await readFile(srcCss, 'utf8')
    for (const [from, to] of FAMILY_RENAMES) css = css.replaceAll(from, to)
    // 参照ファイル名を収集(url(./files/NAME.woff2))。CSS はそのまま(fonts.css からの相対で解決)。
    for (const m of css.matchAll(/url\(\.\/files\/([^)]+)\)/g)) {
      const name = m[1]
      if (name) woff2.add(name)
    }
    cssParts.push(`/* ${rel} */\n${css}`)
  }
  await writeFile(join(FONTS_DIR, 'fonts.css'), cssParts.join('\n'))

  // ファイルはどの family のサブディレクトリにあるか名前から判断(prefix 一致)。
  const familyOf = (name: string): string => {
    if (name.startsWith('fraunces-')) return 'fraunces'
    if (name.startsWith('inter-')) return 'inter'
    if (name.startsWith('jetbrains-mono-')) return 'jetbrains-mono'
    throw new Error(`未知のフォントファイル: ${name}`)
  }
  for (const name of woff2) {
    const src = join(FONT_SOURCE_DIR, familyOf(name), 'files', name)
    await copyFile(src, join(FONTS_FILES_DIR, name))
  }
}

// Pencil HTML のフォント参照(Google Fonts の preconnect / stylesheet link)を、ローカル fonts.css
// への絶対 file URL link に差し替える。さらに font-smoothing 正規化 style を注入する。
// 元の HTML ファイルは書き換えない(Pencil 再 export に対して頑健にするため in-memory 差し替え)。
function patchHtml(html: string, fontsCssUrl: string): string {
  // fonts.googleapis.com / fonts.gstatic.com を指す <link ...> をすべて除去(属性順・改行に寛容)。
  const withoutGoogle = html.replace(
    /<link\b[^>]*?(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*?>/gs,
    '',
  )
  const localLink = `<link rel="stylesheet" href="${fontsCssUrl}" />`
  const injection = `${localLink}\n${NORMALIZE_STYLE}\n</head>`
  if (!withoutGoogle.includes('</head>')) {
    throw new Error('HTML に </head> が見つかりません — フォント差し替えを注入できません')
  }
  return withoutGoogle.replace('</head>', injection)
}

// screen 名 ↔ html ファイル名の対応を検証(事故防止)。過不足があれば fail。
async function validateSlugs(targets: Target[]): Promise<void> {
  const htmlFiles = (await readdir(HTML_DIR))
    .filter((f) => f.endsWith('.html'))
    .map((f) => basename(f, '.html'))
  const htmlSet = new Set(htmlFiles)
  const targetSet = new Set(targets.map((t) => t.screen))

  const missingHtml = targets.filter((t) => !htmlSet.has(t.screen)).map((t) => t.screen)
  const orphanHtml = htmlFiles.filter((f) => !targetSet.has(f))
  if (missingHtml.length > 0 || orphanHtml.length > 0) {
    const lines = ['screen 名と html ファイル名の対応に不整合があります:']
    if (missingHtml.length > 0) {
      lines.push(`  target にあるが html が無い: ${missingHtml.join(', ')}`)
    }
    if (orphanHtml.length > 0) {
      lines.push(`  html にあるが target に無い: ${orphanHtml.join(', ')}`)
    }
    throw new Error(lines.join('\n'))
  }
}

async function main() {
  const config = await loadConfig()
  const referenceDir = resolve(repoRoot, config.referenceDir)
  await mkdir(referenceDir, { recursive: true })

  await validateSlugs(config.targets)
  await buildLocalFonts()

  const fontsCssUrl = pathToFileURL(join(FONTS_DIR, 'fonts.css')).href
  const renderDir = join(HTML_DIR, '.rendered')
  await rm(renderDir, { recursive: true, force: true })
  await mkdir(renderDir, { recursive: true })

  const browser = await chromium.launch()
  const results: Array<{ screen: string; out: string }> = []
  try {
    const context = await browser.newContext({ deviceScaleFactor: config.deviceScaleFactor })
    const page = await context.newPage()
    for (const t of config.targets) {
      const srcHtml = join(HTML_DIR, `${t.screen}.html`)
      const patched = patchHtml(await readFile(srcHtml, 'utf8'), fontsCssUrl)
      // 絶対 file URL の fonts.css を使うので temp HTML はどこに置いても解決する。
      const tmpHtml = join(renderDir, `${t.screen}.html`)
      await writeFile(tmpHtml, patched)

      await page.setViewportSize({ width: t.width, height: t.height })
      await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'load' })
      // フォントのロード完了と描画安定を待つ。
      await page.evaluate(async () => {
        await document.fonts.ready
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      })
      // Web フォントの実ロードをアサート(サイレント fallback 防止)。
      await assertFontsLoaded(page, REF_FONT_FAMILIES)

      const out = join(referenceDir, `${t.screen}.png`)
      // clip で viewport ちょうどを撮る(モバイル角丸の透過は白ページ背景で合成)。
      await page.screenshot({
        path: out,
        clip: { x: 0, y: 0, width: t.width, height: t.height },
      })
      results.push({ screen: t.screen, out })
    }
  } finally {
    await browser.close()
    await rm(renderDir, { recursive: true, force: true })
  }

  console.log('基準 PNG を生成しました(Pencil 忠実 HTML の Chromium 描画):')
  for (const r of results) {
    console.log(`  ${r.screen} -> ${config.referenceDir}/${r.screen}.png`)
  }
  console.log(
    `\nフォント: design/reference/html/fonts/(@fontsource-variable から複製・family 改名)`,
  )
}

main().catch((err) => {
  console.error('基準生成でエラー:', err)
  process.exit(1)
})
