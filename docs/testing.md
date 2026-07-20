# テスト

human-1 のテストは 3 層。すべてルートから `bun run` で回す。

| 層 | コマンド | 対象 | ランナー |
| --- | --- | --- | --- |
| ユニット | `bun test` | `packages/shared`(パーサ・スコア抽出ほか) | bun test |
| E2E | `bun run e2e` | UI をブラウザで疎通(chromium) | Playwright |
| px 一致検証 | `bun run verify:pixels` | UI が Pencil モックと px 単位で一致するか | Playwright + pixelmatch |

補助: `bun run typecheck`(全パッケージ tsc)、`bun run lint` / `bun run check`(Biome)。

## ユニット(bun test)

```sh
bun test
```

`packages/shared/test/*.test.ts` を実行する。新しい共有ロジックはここに追加する。

## E2E(Playwright)

初回のみ chromium を入れる:

```sh
bunx playwright install chromium
```

実行:

```sh
bun run e2e
```

- 設定は `playwright.config.ts`。ブラウザは **chromium のみ**。
- `webServer` が `packages/ui` の Vite dev サーバー(`http://localhost:5199`)を自動起動する。手動起動は不要。
- テストは `e2e/*.spec.ts`。現状はプレースホルダページのスモーク 1 本。M3 で UI を実装したら画面ごとのシナリオを足す。
- トレースなどの出力は `artifacts/`(gitignore 済み)。

## px 一致検証(verify:pixels)

M3 で実装する UI が Pencil モック(6 画面)と **px 単位**で一致するかを検証する。

**基準 PNG はコミットしない**(`design/reference/*.png` は gitignore 済み)。コミット済み PNG を
基準にすると、別マシンや stale 状態で **2〜5% の偽 FAIL** が起きうる(フォント・ラスタライズが環境依存)。
そこでゲートは **「生成 → 検証」の対**に統一する: `verify:pixels` は毎回まず `refs:generate` で
基準 PNG を HTML から焼き直し、その直後に比較する。**HTML の更新のみ**が人手作業(Pencil `export_html`。
下記「基準画像の生成手順」)。

```sh
bun run verify:pixels        # refs:generate(基準を焼き直す) → verify-pixels(比較)。これが正
bun run verify:pixels:only   # 比較のみ(既存の design/reference/*.png を使う。デバッグ用)
bun run refs:generate        # 基準 PNG の再生成のみ
bun run verify:pixels:bootstrap  # 欠けを SKIP 扱い(--allow-missing。立ち上げ期のみ)
```

> `verify:pixels` は生成を内包するので基準が「欠ける」ことは通常起きない。`verify:pixels:only` を
> 単体で使うときだけ strict(基準が欠けていれば FAIL)が効く。

### 仕組み

0. (`verify:pixels` 経由なら)先に `refs:generate` が全 `design/reference/*.png` を HTML から焼き直す。
1. `scripts/pixel-targets.json` の各 `target`(`screen` / `route` / `width` / `height`)について、
2. `packages/ui` の Vite dev サーバーを起動し、指定 `deviceScaleFactor` で Playwright(chromium)スクリーンショットを撮り、
   - スクショ前に **Web フォントの実ロードをアサート**(`document.fonts` に Fraunces/Inter/JetBrains Mono の
     `loaded` な FontFace があるか)。無ければ明示エラーで fail — サイレント fallback で基準・実測とも
     system フォントになる「共倒れ一致(偽 PASS)」を防ぐ。
3. 基準画像 `design/reference/<screen>.png` と `pixelmatch` で比較する。
4. 差分 px 数・差分率を報告。閾値超過で **exit 1**。差分画像と実測画像を `artifacts/pixel-diff/<screen>.diff.png` / `.actual.png` に出力する。

設定キー:

| キー | 意味 |
| --- | --- |
| `port` | 検証用に起動する Vite dev サーバーのポート |
| `referenceDir` | 基準画像ディレクトリ(既定 `design/reference`) |
| `artifactsDir` | 差分・実測画像の出力先(既定 `artifacts/pixel-diff`) |
| `deviceScaleFactor` | スクショの倍率。**基準画像の export 倍率と必ず一致させる**(現状 2) |
| `threshold` | pixelmatch の 1 px 色差許容(0–1) |
| `maxDiffRatio` | 許容する差分 px の割合の既定値(超えると fail) |
| `targets[].maxDiffRatio` | **target 個別の上限**(省略時は上の既定値)。クリーンな 5 画面は `0.003`(0.3%)、whiteboard のみ `0.01`(1%。下記ドットグリッド残差のため) |

### 基準画像が無いとき

基準 PNG はコミットしない生成物なので、`verify:pixels`(生成を内包)なら常に揃う。`verify:pixels:only`
で比較のみを回すときだけ、基準が欠けていると **FAIL(exit 1)**(strict)になる — その場合は先に
`bun run refs:generate` を実行する。立ち上げ期に欠けを許容したいときのみ `verify:pixels:bootstrap`
(`--allow-missing`)で `SKIP(exit 0)` にできる。

### readiness の堅牢化

`verify:pixels` は Vite dev サーバーの起動を次の 3 点で確認する:

1. ポート fetch が成功するだけでなく、返る HTML にアプリ固有マーカー
   (`packages/ui/index.html` の `<meta name="app" content="human-1" />`)が含まれること。別プロセスの
   サーバーを誤認しない。
2. 子プロセスの exit と race し、起動前にプロセスが死んだら **即座に fail**(stderr を添える)。
3. `--strictPort` によりポート衝突時は別ポートに逃げず子プロセスが失敗する(= 2 で検知)。

### 基準画像の生成手順(export_html → refs:generate)

基準 PNG は **「Pencil 忠実 HTML の Chromium 描画」** を正とする。理由: Pencil 自身のキャンバス描画を
撮った PNG を基準にすると、検証側(Chromium スクショ)との**テキストラスタライズ差だけで数 %** 残り、
1% ゲートに届かない(実装品質でなくエンジン差)。基準も検証も同じ Chromium で描くことで、実装と
デザインの**真のレイアウト差だけ**が diff に残る。

手順:

1. **HTML を書き出す**: Pencil エディタで `design/human-1.pen` を開いた状態で Claude に `export_html` を
   依頼し、各フレームを `design/reference/html/<screen>.html`(`pixel-targets.json` の `screen` と同名)
   として保存する。`.pen` は暗号化されており CLI からは書き出せないため、この 1 手だけは Pencil MCP 経由。
2. **基準 PNG を生成する**:

   ```sh
   bun run refs:generate      # = scripts/export-references.ts
   ```

   各 `design/reference/html/<screen>.html` を Playwright chromium(`deviceScaleFactor` 2・
   `pixel-targets.json` の viewport・白ページ背景)で開き、`document.fonts.ready` と描画安定を待って
   `design/reference/<screen>.png` に上書きする。`screen` 名と html ファイル名の対応を検証し、過不足が
   あれば fail する(事故防止)。

**フォントの扱い(重要・オフライン決定性)**: Pencil の export_html は Google Fonts(Fraunces / Inter /
JetBrains Mono)を参照する。これをそのまま描くとネットワーク依存になり、かつアプリ(`@fontsource-variable`)
と glyph がずれる恐れがある。`refs:generate` は実行のたびに `node_modules/@fontsource-variable` から
**アプリと同一の woff2** を `design/reference/html/fonts/` に複製し(family を `Fraunces`/`Inter`/
`JetBrains Mono` に改名)、HTML のフォント参照を **その場で**(元 HTML は書き換えない)ローカル参照へ差し替える。
さらに `-webkit-font-smoothing: antialiased`(アプリ `base.css` と同一)を注入する。`design/reference/html/fonts/`
と `.rendered/` は生成物なので gitignore 済み。

> **CJK フォールバックの一致が要**: primary 3 書体には CJK グリフが無く、日本語はフォールバックへ落ちる。
> Pencil HTML は 3 系統とも末尾 `system-ui, sans-serif`。アプリの `--font-mono` / `--font-display` が
> `monospace` / `serif` 終端だと CJK の行ボックス高が基準とずれて縦ずれ→ px 差になる。`tokens.css` は
> 末尾を `system-ui, sans-serif` に統一してある(変更禁止)。

> `pixel-targets.json` の `screen` / `route` / viewport は実画面に一致済み。ゲートは **per-target**:
> クリーン 5 画面 `0.003`、whiteboard `0.01`。whiteboard の 0.6% 台残差は基準側ドットグリッドが
> **lossy WebP を `background-size: 100% 100%` で拡縮**したラスタで、アプリのドット(canvas で device
> 解像度に解析描画)と位相が漸増的にずれるため(レイアウト差ではない・React Flow 置換で解消予定)。
> 他 5 画面は 0.0-0.04%。

### 基準 HTML の来歴と、このゲートが証明する範囲

基準 HTML(`design/reference/html/*.html`)は Pencil `design/human-1.pen` の Style C 系 6 フレームを
`export_html` したもの。来歴:

| screen | Pencil フレーム ID |
| --- | --- |
| flow1-step1 | `x03Nex` |
| flow2-step2 | `pvtJF` |
| whiteboard | `LhRGm` |
| runs | `uG2hZ` |
| mobile-answer | `j9b5n` |
| mobile-step2 | `cUfSM` |

- export 日: **2026-07-20**、目視監査済み。
- **このゲートが証明するのは「実装 → 基準 HTML への忠実度」**。基準 HTML 自体(= `export_html` の出力)に
  デザイン意図との齟齬があっても検出できない。HTML の正しさは Pencil フレーム(`docs/design-spec.md` §3)
  との目視監査で担保する。デザインを直したら Pencil で該当フレームを更新 → `export_html` で HTML を差し替え
  → `verify:pixels`(自動で基準 PNG を焼き直す)の順。

### 検証環境の固定(macOS 前提)

日本語(CJK)は primary 3 書体にグリフが無く `system-ui` フォールバックで描かれる。**この px 検証は
本開発機(macOS / Hiragino)でのみ有効**。他 OS では system-ui の CJK メトリクスが変わり、行ボックス高の
差で FAIL しうる。単一ユーザー運用のため CJK Web フォントのバンドルは今回見送る(将来 CI 化する場合は
CJK フォントを同梱して環境非依存にする)。

### ロジックの動作確認(参考)

比較ロジック自体は、実測と一致する基準を与えれば `PASS 差分 0px`、意図的にずらした基準を与えれば
`FAIL 差分率 ~99%` で exit 1 になることを確認済み。閾値や基準を疑うときは一時設定でこの両端を再現できる。
