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

M3 で実装する UI が Pencil モック(4 画面)と **px 単位**で一致するかを検証する。

```sh
bun run verify:pixels                    # strict(既定): 基準が欠けていれば FAIL
bun run verify:pixels:bootstrap          # 立ち上げ期用: 欠けを SKIP 扱い(--allow-missing)
bun run verify:pixels path/to/cfg.json   # 設定を差し替え(strict のまま)
```

> **strict が既定**。設定した screen の基準画像が 1 枚でも欠けていれば **FAIL(exit 1)**。
> 基準画像がまだ 1 枚も無い立ち上げ期は `verify:pixels:bootstrap`(`--allow-missing`)を使い、
> 欠けを `SKIP`(exit 0)にする。**M3 で 4 画面の基準画像を生成したら `bootstrap` は不要**になり、
> 通常の `verify:pixels`(strict)に一本化する。

### 仕組み

1. `scripts/pixel-targets.json` の各 `target`(`screen` / `route` / `width` / `height`)について、
2. `packages/ui` の Vite dev サーバーを起動し、指定 `deviceScaleFactor` で Playwright(chromium)スクリーンショットを撮り、
3. 基準画像 `design/reference/<screen>.png` と `pixelmatch` で比較する。
4. 差分 px 数・差分率を報告。`maxDiffRatio` 超過で **exit 1**。差分画像と実測画像を `artifacts/pixel-diff/<screen>.diff.png` / `.actual.png` に出力する。

設定キー:

| キー | 意味 |
| --- | --- |
| `port` | 検証用に起動する Vite dev サーバーのポート |
| `referenceDir` | 基準画像ディレクトリ(既定 `design/reference`) |
| `artifactsDir` | 差分・実測画像の出力先(既定 `artifacts/pixel-diff`) |
| `deviceScaleFactor` | スクショの倍率。**基準画像の export 倍率と必ず一致させる**(現状 2) |
| `threshold` | pixelmatch の 1 px 色差許容(0–1) |
| `maxDiffRatio` | 許容する差分 px の割合(超えると fail) |

### 基準画像が無いとき(現状)

`design/reference/` はまだ空。strict(既定)では基準が欠けていると **FAIL(exit 1)** になる。
立ち上げ期は `verify:pixels:bootstrap`(`--allow-missing`)で回す:
基準が 1 枚も無ければ全 `SKIP(基準未生成)` で exit 0、一部だけ存在する場合は有る画面のみ比較し、
無い画面は個別に `SKIP` 表示する。

### readiness の堅牢化

`verify:pixels` は Vite dev サーバーの起動を次の 3 点で確認する:

1. ポート fetch が成功するだけでなく、返る HTML にアプリ固有マーカー
   (`packages/ui/index.html` の `<meta name="app" content="human-1" />`)が含まれること。別プロセスの
   サーバーを誤認しない。
2. 子プロセスの exit と race し、起動前にプロセスが死んだら **即座に fail**(stderr を添える)。
3. `--strictPort` によりポート衝突時は別ポートに逃げず子プロセスが失敗する(= 2 で検知)。

### 基準画像の生成手順

Pencil エディタ(`.pen` は暗号化されており CLI からは書き出せない)で `design/human-1.pen` を開いた状態で、
Claude に各画面の PNG export を依頼し、`design/reference/<screen>.png`(`pixel-targets.json` の `screen` と同名)として保存する。
このとき **export 倍率を `deviceScaleFactor` と揃える**こと(倍率がずれると寸法不一致で fail する)。

> `pixel-targets.json` の `screen` / `route` / viewport は M3 の UI 実装に合わせた暫定値。
> 実装が固まったら route と実画面へ更新する。

### ロジックの動作確認(参考)

比較ロジック自体は、実測と一致する基準を与えれば `PASS 差分 0px`、意図的にずらした基準を与えれば
`FAIL 差分率 ~99%` で exit 1 になることを確認済み。閾値や基準を疑うときは一時設定でこの両端を再現できる。
