# human-1 — M3 UI Design Spec (Style C · Atelier Warm)

M3 実装者向けの px 単位一致仕様。基準は Pencil `design/human-1.pen` の Style C 系 6 フレームと、
その忠実 export である **`design/reference/html/*.html`（コミット対象。これが px ゲートの正）**。
基準 PNG はコミットせず、`bun run verify:pixels` が毎回 HTML から Chromium で再生成する（運用は
docs/testing.md）。本書執筆時に Pencil 実測ツリーとキャンバス描画が食い違った箇所の判断は本書内で明記。

> **重要な注意（CLAUDE.md との差分）**
> CLAUDE.md は「フォント = Space Grotesk / Inter / JetBrains Mono」「機能色 thinking `#7C3AED` /
> tool `#0B9F66` / XML `#0369A1` / score `#0D9488`」と記載しているが、**正とする Style C フレームは
> これらを使っていない**。Style C は display フォントに **Fraunces**、機能色に暖色のミュート版
> （thinking `#7B4A68` / tool `#5C7050` / xml `#40676B` …）を使う。本書は正とするフレームの実値に従う。
> M3 のトークン定義は本書（= APM5U / .pen 変数）を採用すること。

---

## 0. 対象フレームと状態

| フレーム名 | Node ID | サイズ | アプリの状態（推定） |
|---|---|---|---|
| C — Flow 1 Step 1 実行中 | `x03Nex` | 1440×900 | Raw output タブ。step1（thinking + 並列 tool call ×2）を送信済みで harness がツール実行中。エディタは送信済み内容を表示・入力ロック。右下は「結果を待機中…」 |
| C — Flow 2 Step 2 開始 | `pvtJF` | 1440×900 | tool_result ×2 を受信し、エディタをリセットして step2 を書き始める直前（下書き無し・空エディタ・クイックスタート提示） |
| C — Workspace Whiteboard | `LhRGm` | 1440×900 | Whiteboard タブ。React Flow 相当のノードグラフ編集中（ノード7個）。「Mermaid として挿入」可能 |
| C — Runs | `uG2hZ` | 1440×900 | Runs 画面。run #12「ECサイト設計」を選択中。学習曲線・統計・ロールアウト・ルーブリック表示 |
| C — Mobile Answer | `j9b5n` | 390×844 | モバイル1カラム。1ターンの完全な回答（trainer→thinking→function_calls→final+mermaid）を表示。送信ボタン active |
| C — Flow 3 Mobile Step 2 | `cUfSM` | 390×844 | モバイル step2。履歴（trainer/you step1/tool_result ×2/banner）+ 下部エディタ。送信 disabled |

- スタイルタイル（トークン出所）: `APM5U` Style C — Atelier Warm
- 全フレーム: `cornerRadius` はデスクトップ 0（矩形）、モバイル 28（端末角丸）。`fill = $bg (#F4EFE6)`、`clip: true`。

---

## 1. デザイントークン

テーマは `mode: [light, dark]` の 2 テーマ対応。**全フレームは light を描画**。dark 値は下表右列（実装は両対応必須）。
`resolveVariables` で得た light 実値が各コンポーネント記述の hex。

### 1.1 カラー変数（`$name` → light / dark）

| 変数 | light | dark | 用途 |
|---|---|---|---|
| `bg` | `#F4EFE6` | `#1E1A15` | フレーム背景（キャンバス） |
| `surface` | `#FCFAF5` | `#262119` | カード面（RequestCard / EditorCard / タイル） |
| `surface2` | `#EFE9DC` | `#2F2921` | サブ面（SystemMsg / StatusStrip / SoonPill / FormatGroup bg） |
| `surface3` | `#E7DFCE` | `#3A332A` | 押し込み面（WaitBtn / SendBtn disabled bg `#E7DFCE`） |
| `border` | `#E3DBCA` | `#3B342A` | 標準ボーダー（1px） |
| `border-strong` | `#CFC4AD` | `#4C4437` | 強ボーダー（chip / disabled dot） |
| `text-primary` | `#2B2317` | `#F0EAE0` | 主要テキスト |
| `text-secondary` | `#57503F` | `#C6BCAC` | 二次テキスト |
| `text-muted` | `#8B8170` | `#94897A` | ミュート（メタ / mono ラベル / プレースホルダ） |
| `accent` | `#8A6830` | `#C29A5B` | アクセント（ロゴドット / active nav 下線 / trainer 左線 / 送信 primary bg） |
| `accent-strong` | `#6F5322` | `#D3AF77` | 強アクセント（TRAINER ロール文字 / final chip 文字 / total pill） |
| `accent-soft` | `#F0E7D2` | `#33291A` | アクセント淡（trainer card bg / active run bg / step chip / whiteboard service node） |
| `on-accent` | `#FBF6EA` | `#241C0F` | アクセント上文字（primary 送信ボタン文字 / mermaid ボタン文字） |
| `thinking` | `#7B4A68` | `#B98BA9` | thinking 機能色（ロール / アイコン / タイマー active） |
| `thinking-soft` | `#F1E8EC` | `#322631` | thinking 淡（block bg / chip / timer chip bg） |
| `tool` | `#5C7050` | `#96AE88` | tool 機能色（tool ロール / check / conn dot / 完了ステータス） |
| `tool-soft` | `#E9EBDD` | `#2A3024` | tool 淡（function_calls block bg / tool_result bg / banner bg） |
| `xml` | `#40676B` | `#7FA7AC` | XML 機能色（= `curve`。XML ロール / score 数値 / ER entity 枠） |
| `xml-soft` | `#E4EBE7` | `#253135` | XML 淡（XML insert chip bg / ER head bg） |
| `curve` | `#40676B` | `#7FA7AC` | 学習曲線バー / score 数値（`xml` と同値） |
| `memo` | `#8C6A2F` | `#D6B380` | 付箋（memo）文字・左線 |
| `memo-soft` | `#F2E9D3` | `#362E1E` | 付箋 bg |
| `warn` | `#AC5B3B` | `#D08A6A` | 警告/実行中（`[tool_result]` マーカー / 実行中… / zap bolt / 低スコア run dot） |
| `warn-soft` | `#F3E2D8` | `#3A2A20` | 警告淡（未使用だが定義あり） |

### 1.2 フォント

| 変数 | 値 | 用途 |
|---|---|---|
| `font-display` | **Fraunces** | ワードマーク `human-1`、大きな score 数値、Runs の run タイトル（24/26/32） |
| `font-ui` | **Inter** | UI ラベル、本文（trainer/thinking 本文）、ボタン文字、タブ、insert chip |
| `font-mono` | **JetBrains Mono** | コード / tool 名 / XML / メタ / ロールラベル（SYSTEM 等）/ タイマー / スコア tag |

- Fraunces / Fable score 数値は常に `fontWeight 600`。
- 本文（Inter）の `lineHeight` は 1.55〜1.65（各所参照）。mono 本文は 1.5〜1.6。
- ロール系ラベル（`SYSTEM` `TOOLS` `TRAINER · EPOCH 3` `LEARNING CURVE` 等）は mono・大文字・`letterSpacing 1.2`（一部 1.4 / 1.5）。

### 1.3 共通スタイル規約

- **cornerRadius**: カード=8、内部ブロック/ボタン/入力=6、フォーマットアイコン=4、pill/chip/dot=999。
- **標準ボーダー**: `1px solid $border (#E3DBCA)`。区切り線・カード枠・invoke 枠。
- **メッセージブロックの左アクセント線**: `strokeWidth {left: 2}`（trainer=`$accent`、thinking=`$thinking`、function_calls/tool_result/banner=`$tool`、you step1=`$border-strong`、memo=`$memo`）。
- **セクション見出し下線**: `strokeWidth {bottom: 1} $border`（Header / ReqHeader / TopBar / Toolbar / StatusStrip / ListHead）。
- **BottomBar 上線**: `strokeWidth {top: 1} $border`。
- **active タブ/nav**: `strokeWidth {bottom: 2} $accent`、ラベル `text-primary` + weight 600。inactive はラベル `text-muted` + weight normal、線なし。
- 影（フローティング要素のみ）: Whiteboard の NodePalette / MiniMap = `shadow outer, offset(0,10), blur24, spread -6, color #3A2C1526`。

---

## 2. 共通コンポーネント

複数フレームで同形。実装は 1 コンポーネント化推奨。

### 2.1 Desktop Header（`Header` — Flow1/Flow2/Whiteboard/Runs で同一）

- frame: horizontal, `height 64`, `width fill`, `padding [0,28]`, `gap 26`, `alignItems center`, 下線 `{bottom:1} $border`。fill 無し（親 `$bg` 透過）。
- 子（左→右）:
  1. **Logo**（h-frame, gap 9）: LogoDot ellipse 9×9 `$accent` → Wordmark `human-1` Fraunces 19/600 `text-primary` → Badge `train` mono 11 `text-muted`。
  2. **Nav**（h-frame, gap 18）: 各項目 `padding [6,2]`。active=下線`{bottom:2} $accent`+ラベル Inter 13/600 `text-primary`。inactive=Inter 13/normal `text-muted`。
     - Flow1/Flow2/Whiteboard: `Workspace` active, `Runs` inactive。
     - Runs: `Workspace` inactive, `Runs` active。
  3. **HeaderSpacer**: `width fill, height 1`（フレックス押し出し）。
  4. **TrainingChip**（h-frame, gap 7, `padding [6,12]`, radius 999, 枠 `1px $border-strong`, fill 無し）: TrainDot ellipse 7×7 `$accent` → `Training · epoch 3`（Runs は `epoch 7`）Inter 12/600 `text-secondary`。
  5. **ScoreChip**（h-frame, gap 6, alignItems center）: `avg` mono 11 `text-muted` → `8.4`（Runs `8.5`）Fraunces 17/600 `$xml(#40676B)` → `/10` mono 11 `text-muted`。
  6. **ConnChip**（h-frame, gap 7）: ConnDot ellipse 8×8 `$tool(#5C7050)` → `live` mono 11 `text-muted`。

### 2.2 Main レイアウト（Desktop, 3画面共通）

- `Main`: h-frame, `padding 20`, `gap 20`, `width fill`, `height fill`。
- 左カラム: 固定幅カード `width 440`（Runs のみ 400）, radius 8, fill `surface`, 枠 1px `border`, `clip`, layout vertical。
- 右カラム: `width fill` の EditorCard（Runs は RunDetail が非カード v-frame）。

### 2.3 Editor 系バー（Flow1/Flow2/Whiteboard の EditorCard 内）

**EditorTopBar**: h-frame `padding [9,18]` gap 12, 下線 `{bottom:1}`。
- 左: **Tabs**（h-frame gap 18）: `Raw output` / `Whiteboard` / `Code`＋SoonPill。各 `padding [6,2]`。active タブは下線`{bottom:2} $accent`+Inter 13/600 `text-primary`、他は Inter 13/normal `text-muted`。
  - Flow1/Flow2: Raw output active。Whiteboard: Whiteboard タブ active。
  - **SoonPill**: `padding [1,7]` radius 999 fill `surface2` → `soon` mono 9 `text-muted`。
- 右: 状態表示（frame ごとに異なる。§4 参照）。

**Toolbar**（Flow1/Flow2 のみ）: h-frame `padding [8,18]` gap 10, 下線 `{bottom:1}`。
- **FormatGroup**: h-frame `padding 3` gap 1 radius 6 fill `surface2`。子 5 個（bold/italic/strikethrough/heading/list）各 `padding [5,7]` radius 4, lucide アイコン 15×15。
  - Flow1（送信済み・非活性）: アイコン色 `$border-strong (#CFC4AD)`。
  - Flow2（編集中・活性）: アイコン色 `text-secondary (#57503F)`。
- **Divider**: 1×18 `$border`。
- **Insert chips ×4/5**（Thinking/Tool call/XML/Mermaid）: h-frame gap 6 `padding [5,10]` radius 6, lucide 14×14 + Inter 12/600。
  - Flow1（非活性）: 全 chip fill `surface`, 枠 1px `border`, アイコン/文字 `$border-strong`。
  - Flow2（活性・機能色）: 枠なし、各 chip は機能色ペア → Thinking: bg `thinking-soft` 文字 `thinking`／Tool call: bg `tool-soft` 文字 `tool`／XML: bg `xml-soft` 文字 `xml`／Mermaid: bg `surface2` 文字 `text-secondary`。
- 右端: Flow2 は ToolbarSpacer(fill) 後に `/ でブロック挿入` mono 11 `text-muted`。Flow1 は右端ヒント無し（Spacer のみ）。

**BottomBar**: h-frame `padding [12,18]` gap 12, 上線 `{top:1}`。
- 左: **SendHint** `⌘↵ で送信 · thinking → tools → final の順で配信` mono 11 `text-muted`（Whiteboard は `⌘↵ で送信 · 図は Mermaid として本文に添付`）。
- FootSpacer(fill)。
- 右ボタン群（frame ごと。§4）。

### 2.4 Request-side メッセージブロック（左カラム）

共通の見た目パターン:
- **SystemMsg / ToolsCard**: radius 6, fill `surface2`, `padding [10,14]`, v-frame gap 7。見出し行 = mono 10 `text-muted` `letterSpacing 1.2` + 右寄せメタ。
- **TrainerMsg**: radius 6, fill `accent-soft (#F0E7D2)`, 左線 `{left:2} $accent`, `padding [12,16]`, gap 9。
  - ロール `TRAINER · EPOCH 3` mono 10/600 `accent-strong` LS1.2。本文 Inter 14/normal `text-primary` LH1.65。XML 行 mono 12 `$xml` LH1.6。
- **ThinkingBlock**: radius 6, fill `thinking-soft`, 左線 `{left:2} $thinking`, `padding [10,14]`, gap 5。
  - head: brain 14 `thinking` + `thinking` mono 11/600 `thinking` + spacer + 状態 pill。本文 Inter 13/italic `text-secondary` LH1.65。
- **FunctionCallsBlock**: radius 6, fill `tool-soft`, 左線 `{left:2} $tool`, `padding [10,14]`, gap 7。
  - head: terminal 14 `tool` + `function_calls` mono 11/600 `tool` + spacer + ParallelPill。
  - **Invoke 行**: radius 6 fill `surface`, 枠 1px `border`, `padding [8,12]` gap 9。状態アイコン 13（完了=check `tool` / 実行中=loader-circle `warn`）+ 名前 mono 12/600 `text-primary` + パラメータ mono 11 `text-muted` + spacer + ステータス（`完了 · 0.4s` mono 10.5/600 `tool` ／ `実行中…` mono 10.5/600 `warn`）。
- **ToolResultBlock**: radius 6, fill `tool-soft`, 左線 `{left:2} $tool`, `padding [9,16]`, gap 5。
  - head: `[tool_result]` mono 10.5 `warn` + `<tool> · exit 0 · 0.4s` mono 10.5/600 `tool` + spacer + NEW バッジ（`padding [1,6]` radius 4 fill `surface` → `NEW` mono）。本文 mono 11 `text-secondary` LH1.5。

### 2.5 状態 pill 類

- **SentTag**（送信済み）: h-frame gap 5 `padding [2,8]` radius 999 fill `surface` 枠 1px `border` → check 10 `tool` + `送信済み` Inter 10.5/600 `text-secondary`。
- **ParallelPill**（並列 ×2）: gap 5 `padding [3,9]` radius 999 fill `surface` 枠 1px `border` → zap 11 `warn` + `並列 ×2` Inter 11/600 `text-secondary`。
- **StepChip**（`STEP 2`）: `padding [3,10]` radius 999 fill `accent-soft` → mono 10/600 `accent-strong` LS0.8。

### 2.6 Buttons

- **Primary 送信（active）**: radius 6 fill `$accent (#8A6830)`, `padding [9,20]`, gap 7 → `送信` Inter 13/700 `on-accent` + arrow-up 15 `on-accent`。（Whiteboard の SendBtn `n2d96` も同じ。）
- **Primary 送信（disabled）**: fill `surface3 (#E7DFCE)`, 文字/アイコン `text-muted`（Flow2 `SmQgA` / モバイル step2 `MiNVQ`）。
- **Secondary（途中経過 / ProgressBtn）**: radius 6, fill 無し, 枠 1px `border-strong`, `padding [8,14]`, gap 6 → activity 14 + `途中経過` Inter 13/600 `text-secondary`。
- **WaitBtn（結果を待機中…, Flow1 のみ）**: radius 6 fill `surface3`, `padding [9,20]`, gap 7 → loader-circle 15 + `結果を待機中…` Inter 13/600 `text-muted`。

---

## 3. 画面別レイアウトツリー

各値は resolveVariables 済み light 実値。座標 x/y は Whiteboard キャンバス内のみ絶対（layout:none）。

### 3.1 Flow 1 Step 1 実行中（`x03Nex`）

ルート: v-frame 1440×900, fill `$bg`, clip。子 = Header(§2.1) + Main。
- **Main** `taUz2`: h-frame padding20 gap20。
- **RequestCard** `QWbA9`（width 440, surface, 枠1, radius8, clip, vertical）:
  - **ReqHeader** `FhuCQ`: h `padding [13,18]` gap10 下線。`REQUEST · turn 4` mono 11 `text-muted` LS1.2 + spacer + **TimerChip** `t7YAI`（radius999 fill `surface2` `padding [4,10]` gap5 → brain 12 `text-muted` + `—:—` mono 12/600 `text-muted`）。※タイマー未計測状態。
  - **ReqBody** `R1RHY`: v `padding 18` gap12。
    - SystemMsg `xLxG7`: head（`SYSTEM` mono10 LS1.2 + spacer + `8.2k chars` mono10）+ collapsed 行（chevron `▸` + プレビュー `<system-reminder> あなたは訓練中の human-1。応答は thinking→tools→final の順で…` mono 12 `$xml`）。
    - ToolsCard `VLM60`: head（`TOOLS` + `リクエストで定義 · 4`）+ 4 行。各 ToolRow: lucide 13 `tool` + 名前 mono 12 `text-primary` + spacer + シグネチャ mono 10 `text-muted`。
      - `exec_command`(terminal, `(cmd)`) / `web_search`(search, `(query, max_results?)`) / `apply_patch`(diff, `(patch)`) / `view_image`(image, `(path)`)。
    - TrainerMsg `NDI0i`: ロール + 本文『前エポックの講評: DB分割の判断は良い(+1.5)。今回は EC サイトの注文システムを設計せよ。全体アーキテクチャと ER 図を含めること。』+ XML 行『<required>図は Whiteboard で作成し Mermaid で添付</required>』。
- **EditorCard** `LkTR2`（width fill, surface, 枠1, radius8, clip, vertical）:
  - EditorTopBar `H8NBE`: Tabs（Raw output active）+ spacer + **DraftStatus**（DraftDot ellipse 6 `tool` + `下書き · 自動保存` mono 11 `text-muted`）。
  - Toolbar `oFIAX`: **非活性状態**（FormatGroup アイコン & insert chip すべて `border-strong` グレー、chip は surface+枠）。§2.3。
  - **StatusStrip** `Ch53j`: h `padding [6,18]` gap8 fill `surface2` 下線 → loader-circle 13 `$accent` + `harness がツールを実行中 · step 1 送信済み` Inter 11.5/500 `text-secondary` + spacer + `0:04` mono 11/600 `text-muted`。（このストリップは Flow1 固有）
  - **EditorBody** `yctTK`: v `padding [12,20]` gap10 clip。送信済み内容を read-only 表示:
    - ThinkingBlock `T5aH2`: head に SentTag（送信済み）。本文『注文システムの核は在庫と決済の整合性。まず既存スキーマを確認し、在庫引当をイベント駆動の Saga にするか判断する。』
    - FunctionCallsBlock `BYFqs`: ParallelPill（並列 ×2）。Invoke `exec_command`（check `tool` / `cmd: cat schema.sql | head -50` / `完了 · 0.4s`）と `web_search`（loader-circle `warn` / `query: saga pattern order inventory` / `実行中…`）。
  - BottomBar `f08LF`: SendHint + spacer + **WaitBtn**（結果を待機中…）。

### 3.2 Flow 2 Step 2 開始（`pvtJF`）

ルート: 同構造。Header `BnMYw`（Workspace active, epoch3, avg 8.4）。
- **RequestCard** `WXOMw`（width 440）:
  - ReqHeader `T5pyxw`: `REQUEST · TURN 4 · STEP 2` mono 10 LS1.2 + spacer + **Timer**（brain 13 `thinking` + `00:07` mono 12/600 `thinking`）。※タイマー計測中 = thinking 色。
  - ReqBody `KEU2Q`: v padding18 gap10。
    - **SysRow** `L3YKza`（1 行折り畳み, fill `surface2` radius6 `padding [8,14]`）: `▸` + `SYSTEM` mono10 LS1.2 + spacer + `8.2k chars`。
    - **ToolsRow** `awo9W`（同形）: `▸` + `TOOLS` + spacer + `リクエストで定義 · 4`。
    - TrainerMsg `wjt2p`（`padding [11,16]` gap7）: ロール + 本文（Flow1 と同文、Inter 13 LH1.6）。
    - **YouStep1** `HP4RC`（fill `surface2`, 左線 `{left:2} $border-strong`, radius6, `padding [9,16]`, gap7）: 過去の自分の step1。
      - head: `YOU · STEP 1` mono 10/600 `text-muted` LS1.2 + check 11 `tool` + spacer + `12:04:31` mono 9.5 `text-muted`。
      - think 行: `▸` + `<thinking> 注文システムの核は在庫と決済の整合性…` mono 11/italic `text-muted`。
      - chips: YChip ×2（`exec_command` / `web_search`）各 radius999 fill `surface` 枠1 `padding [3,9]`。
    - **ToolResult1** `KW9gR`（§2.4）: `exec_command · exit 0 · 0.4s` + NEW。本文『schema.sql · 42 lines\nCREATE TABLE orders (id uuid PRIMARY KEY, user_id uuid, …』
    - **ToolResult2** `ANDF5`: `web_search · 5 results · 1.2s` + NEW。本文『Saga pattern — microservices.io\n分散トランザクションを結果整合で実装するパターン…』
- **EditorCard** `iPBF2`:
  - TopBar `Ct72q`: Tabs（Raw output active）+ spacer + **StepChip**（`STEP 2` accent-soft）+ **Draft**（DraftDot 6 `border-strong` + `下書きなし` mono 11 `text-muted`）。
  - Toolbar `i5griF`: **活性状態**（§2.3。FormatGroup アイコン `text-secondary`、insert chips 機能色、右端 `/ でブロック挿入`）。
  - **Body** `aLDa2`: v `padding [14,20]` gap12 clip。空エディタ + ガイド:
    - **Stepper** `dJ3V5`（h-frame gap8）: [①送信済 check `tool` 枠dot16] `step 1 送信` mono10.5 — line 22×1 `border-strong` — [②check dot] `tools 実行 ×2` — line — [③数字`2` on-accent, dot fill `$accent`] `step 2 作成中` mono 10.5/600 `text-primary`。
      - dot: 16×16 radius999。①②= fill `surface` 枠1 `tool`。③= fill `$accent` 枠 `$accent`, 中に `2` mono 9/600 `on-accent`。
    - **Banner** `uJOzJ`（fill `tool-soft`, 左線 `{left:2} $tool`, radius6, `padding [9,16]`, gap9）: inbox 14 `tool` + `tool_result ×2 を受信しました — エディタをリセットし、step 2 を開始` Inter 12.5/500 `text-secondary` + spacer + `結果を表示 ←` Inter 11.5/600 `tool`。
    - **Composer** `ymUVQ`（h gap3 `padding [4,2]`）: Caret 2×17 `$accent` + プレースホルダ `tool の結果を踏まえて、続きの thinking / final を書く…` Inter 13.5 `text-muted`。
    - **QuickStart** `m6c9a`（h gap8 padding2）: `クイックスタート` mono 9.5 `text-muted` LS1 + 3 chips（機能色 fill・枠なし・radius6 `padding [5,11]` gap6, lucide12 + Inter 11.5/600）:
      - `続きの thinking`（brain `thinking`, bg `thinking-soft`）/ `さらに tool call`（terminal `tool`, bg `tool-soft`）/ `final を書く`（corner-down-right `text-secondary`, bg `surface2`）。
  - BottomBar `GswPo`: SendHint + spacer + Secondary(途中経過) + **Primary 送信 disabled**（fill `surface3`, 文字 `text-muted` 700, arrow-up `text-muted`）。

### 3.3 Workspace Whiteboard（`LhRGm`）

ルート: Header `ncKqN`（Workspace active）+ Main `Fr2bp`。
- **RequestCard** `BKoC0`（width 440）: ReqHeader `kAE5F` + ReqBody `wHaNz`。**内容は Flow1 の RequestCard と同一構造**（timer 表示は要確認、実測は Flow1 と同型）。
- **EditorCard** `gsDI3**:
  - EditorTopBar `C578T`: Tabs（**Whiteboard タブ active**、Raw output/Code inactive）+ spacer + DraftStatus（DraftDot 6 `tool` + `ノード 7 · 自動保存` mono 11 `text-muted`）。
  - **WbCanvas** `rn88v`（width/height fill, clip, **layout: none**, fill = shader `dotgrid.glsl`）:
    - **shader uniforms**: `u_bg #FCFAF5`, `u_dot #CFC4AD`, `u_spacing 24`, `u_radius 1.1`。ドットグリッド背景（`design/dotgrid.glsl` 参照。cell = mod(frag, spacing), dot = 1-smoothstep(r, r+1.2, dist), color = mix(bg, dot, dot*0.55)）。
    - **エッジ（path, stroke `text-muted` 1.5 round）**: EdgeGwOrd(x400,y130) / EdgeOrdPay(x490,y227) / EdgeOrdDb(x400,y260) / EdgeErOrd(x274,y237)。曲線。
    - **エッジラベル chip**（radius999 fill `surface` 枠1 `padding [2,8]` → mono 9 `text-secondary`）: `HTTP`(424,162) / `Saga`(526,226) / `SQL`(424,292) / `1:N`(284,296)。
    - **Service ノード ×3**（radius6 fill `accent-soft`, 左線 `{left:2} $accent`, 160×46, justify center → mono 12/600 `text-primary`）: `API Gateway`(330,84) / `Order Service`(330,214) / `Payment Service`(610,214)。
    - **Memo（付箋）** `bPTG6`（radius6 fill `memo-soft`, 左線 `{left:2} $memo`, width190 `padding [10,12]`, **rotation 2°**）: `決済は外部 PSP に委譲。\n在庫は Saga で結果整合。` mono 12 `memo` LH1.5。pos(44,88)。
    - **DB ノード** `q7h19`（layout none, 130×78, pos 345,344）: 円柱 path DbBody（fill `tool-soft` stroke `tool` 1.5）+ DbRim ellipse 130×22 + `orders-db` mono 11/600 center + `PostgreSQL` mono 9 `tool` center。
    - **ER Entity** `g52pcH`（radius6 fill `surface`, 枠 `1.5 $xml`, width210, clip, pos 64,300）: ErHead（fill `xml-soft` `padding [6,10]` → `orders` mono 11/600 `$xml` + spacer + `entity` mono 9 `text-muted`）+ 4 行（各上線`{top:1} border` `padding [4,10]`, フィールド mono11 `text-primary` + spacer + 型 mono10 `text-muted`）: `id`/`uuid PK` · `user_id`/`uuid FK` · `status`/`enum` · `total`/`int`。
    - **Class ノード** `BGdIM`（radius6 fill `surface`, 枠 `1.5 $thinking`, width220, clip, pos 640,344）: ClassHead（fill `thinking-soft` → `OrderSaga` mono 11/600 `thinking` + spacer + `class` mono 9 `text-muted`）+ 3 メソッド行（上線`{top:1}` `padding [4,10]` mono 11 `text-secondary`）: `+ start(order)` / `+ reserveStock()` / `+ capturePayment()`。
    - **NodePalette** `W3kxju`（pos 16,14, radius8 fill `surface` 枠1 `border-strong`, **影**, `padding 4` gap2, h-frame）: 6 パレット + divider。各 `padding [5,10]` radius6 gap6, lucide13 + Inter12。`サービス` のみ active（fill `accent-soft`, アイコン/文字 `accent-strong` 600）。他は fill 無し・文字 `text-secondary`: `付箋`(sticky-note) / `DB`(database) / `ER`(table) / `クラス`(braces) / divider 1×18 / `接続`(spline)。
    - **MermaidBtn** `s2nQKt`（pos 757,16, radius6 fill `$accent` `padding [8,14]` gap7）: git-branch 14 `on-accent` + `Mermaid として挿入` Inter 12/600 `on-accent`。
    - **ZoomCtl** `i75jjh`（pos 16,649, radius6 fill `surface` 枠1 `padding [4,10]` gap10）: `−` / `100%` / `+` すべて mono 11 `text-secondary`。
    - **MiniMap** `D5GTv5`（pos 774,577, 150×96, radius8 fill `surface` 枠1 `border-strong`, **影**, layout none）: 縮小ノード矩形群（Mini-Gw/Ord/Pay `accent` · Mini-Db `tool` · Mini-Er `xml` · Mini-Cls `thinking` · Mini-Memo `memo-soft`）+ MiniViewport 76×60 枠 `accent-strong`。
  - BottomBar `vE6of`: SendHint（`図は Mermaid として本文に添付`）+ spacer + Secondary(途中経過) + **Primary 送信 active**（fill `$accent`, 文字 `on-accent`）。

### 3.4 Runs（`uG2hZ`）

ルート: Header `n0BJ5Q`（**Runs タブ active**, epoch7, avg 8.5）+ Main `X9wecn`。
- **RunsListCard** `i9aUZB`（width 400, surface, radius8, 枠1, clip, vertical）:
  - **ListHead** `sx8bX`: `padding [13,18]` gap8 下線 → `TRAINING RUNS` mono 11 `text-muted` LS1.2 + spacer + **CountPill**（radius999 枠1 `border-strong` `padding [3,10]` → `7 runs` mono 10 `text-secondary`）。
  - **ListBody** `IqJGx`: v `padding [12,10]` gap3。7 run 行 + 区切り線（1px `border`）。
    - **Run 行**（h-frame radius6 `padding [13,14]` gap12, alignItems center）:
      - Info（v gap5）: TitleRow（h gap8: StatusDot ellipse 7 + タイトル Inter 14/600 `text-primary`）+ Meta mono 11 `text-muted`。
      - **Spark**（h-frame gap3 height26, alignItems end）: 3〜8 本の bar（width6, radius2）。値に応じ高さ。
      - **AvgBox**（v alignItems end gap1）: AvgVal Fraunces 17/600 + `avg` mono 9 `text-muted` LS1。
    - **選択中（`Run_ECサイト設計` IN5EY）**: fill `accent-soft`, 左線 `{left:2} $accent`, StatusDot `$accent`, spark bar `$accent`, AvgVal `$xml`。値: `ECサイト設計` / `7 epochs · 2h ago` / `6.1`。
    - 非選択（fill 無し, 左線なし, spark bar `border-strong`, AvgVal `text-secondary`）: `決済基盤`(green dot / `5 epochs · 5h ago` / 7.2) · `認証システム`(5.4 / `6 epochs · 1d ago`) · `リアルタイム同期`(4.8 / `4 epochs · 2d ago`) · `検索基盤`(6.7 / `8 epochs · 3d ago`) · `通知配信`(3.9 / `3 epochs · 4d ago`) · `データ整合性`(7.8 / `5 epochs · 6d ago`)。
      - **StatusDot 色は PNG を正**: ECサイト設計=`$accent` 金、通知配信=くすんだ赤茶（`$warn` 相当・低スコア）、その他=`$tool` 緑。（実測ツリーでは非選択行の TitleRow を全数展開していないため PNG 準拠。）
- **RunDetail** `MkjGT`（width fill, v-frame gap16, 非カード）:
  - **DetailHead** `ZHfnZ`（h gap16 alignItems center）:
    - TitleCol（v gap5 fill）: DetailTitleRow（**RunTag** radius6 枠1 `border-strong` `padding [3,8]` → `run #12` mono 11 `text-secondary`; + `ECサイト設計` Fraunces 24/600 `text-primary`）+ DetailMeta `trainer: claude -p  ·  codex 殻  ·  2026-07-19  ·  7 epochs · 41 turns` mono 11 `text-muted`。
    - **GrowthBadge** `bvG5J`（radius999 枠1 `tool` `padding [6,13]` → `+6.0 growth ↗` mono 12/600 `tool`）。
    - **CurrentScore** `lfYOT`（v alignItems end gap1）: `8.5` Fraunces 32/600 `$xml` + `CURRENT SCORE` mono 9 `text-muted` LS1.5。
  - **CurveCard** `QlIO2`（radius8 fill `surface` 枠1 `padding [16,20]` gap14, v）:
    - CurveHead: `LEARNING CURVE` mono 11 LS1.2 + spacer + `score / epoch` mono 10（両 `text-muted`）。
    - **PlotRow** `OgWqD`（h gap12）: **YAxis**（width22 height150 v justify space-between, alignItems end）目盛 `10/8/6/4/2/0` mono 10 `text-muted`。**Bars** `A2GSoG`（h gap14 fill）: 7 本の Wrap_ep（各 width fill, height150, v justify end, alignItems center, gap6）= 値ラベル mono 11 `text-secondary` 上 + Bar 矩形（width34, radius `[3,3,0,0]`, fill `$curve/$xml (#40676B)`）。
      - 値と高さ: ep1 2.5(37.5) / ep2 3.5 / ep3 4.5 / ep4 5.0 / ep5 6.0 / ep6 7.5 / ep7 8.5（高さ ≒ 値×15px）。
    - Baseline 1px `border` fill。
    - EpochLabels `ixYem`（h gap14 `padding-left 34`）: `ep1`〜`ep7` mono 11 `text-muted` center。
  - **StatTiles** `e0xqQi`（h gap14 fill）: 4 タイル（各 fill fill, radius8 `surface` 枠1 `padding [13,16]` gap5, v）:
    - Cap mono 9 `text-muted` LS1.2 + Val Fraunces 26/600 + Hint mono 10 `text-muted`。
    - `AVG SCORE` / `6.1`(色 `$xml`) / `+2.3 vs ep1`。`EPOCHS` / `7`(text-primary) / `41 turns total`。`TOKENS` / `48.2K` / `12.4K in · 35.8K out`。`BEST TURN` / `8.5` / `turn 38 · ep7`。
  - **BottomRow** `l9OvTn`（h gap16 fill height fill）:
    - **RolloutCard** `vd5EK`（width fill, radius8 `surface` 枠1 `padding [14,16]` gap8, clip, v）:
      - RollHead: `ROLLOUT TIMELINE` mono 11 LS1.2 + spacer + `epoch 7 · 6 turns` mono 10（`text-muted`）。
      - **Row_turn ×6**（h radius6 `padding [6,8]` gap10 alignItems center）: Marker ellipse 7 + TurnNo mono 11 `text-secondary` width54 + **Chips**（h gap6 fill）+ RowScore mono 13/700 `$xml`。
        - Chips: `thinking`(fill `thinking-soft` 文字 `thinking`) / `tool ×N`(fill `tool-soft` 文字 `tool`) / `final`(fill `accent-soft` 文字 `accent-strong`)。各 radius999 `padding [2,8]` mono 10。
        - turn34: thinking/tool ×2/final · 7.5 / turn35: tool ×1 · 7.0 / turn36: (tool なし) · 8.0 / turn37: tool ×3 · 8.0 / **turn38（選択・fill `accent-soft`, Marker `$accent`）**: tool ×1 · 8.5 / turn39: (tool なし) · 8.5。
    - **RubricCard** `EOMWC`（width 400, radius8 `surface` 枠1 `padding [14,16]` gap10, clip, v）:
      - RubHead: `TRAINER RUBRIC v2` mono 11 LS1.2 + spacer + `claude -p` mono 10（`text-muted`）。
      - 4 criteria（v gap4）: **NameRow**（CritName Inter 13/600 `text-primary` + spacer + **ScorePill** radius6 fill `surface2` `padding [2,8]` → `[SCORE: x/10]` mono 11/700 `$xml`）+ CritDesc mono 11 `text-muted`。
        - `正確性` [8.5] 教師軌跡との差分は決済の冪等性のみ / `設計判断` [7.0] 3サービス分割は妥当・境界づけが明快 / `tool 効率` [8.0] 並列 exec / web_search を適切に活用 / `説明の明快さ` [9.0] Mermaid ER 図で設計意図を可視化。
      - RubDivider 1px `border`。
      - **RubTotal** `wxEiZ`: `TOTAL · weighted` Inter 13/700 `text-primary` + spacer + **TotalPill**（radius6 fill `accent-soft` `padding [3,9]` → `[SCORE: 8.0/10]` mono 11/700 `accent-strong`）。

### 3.5 Mobile Answer（`j9b5n`, 390×844, radius28）

ルート: v-frame, fill `$bg`, clip。子 = MobHeader + MobBody + InsertToolbar + MobBar。
- **MobHeader** `IWnms`（h `padding [12,16]` gap8 下線）: LogoDot 9 + `human-1` Fraunces 17/600 + `train` mono 10.5 `text-muted` + spacer(fill) + **TimerChip**（radius999 fill `thinking-soft` `padding [5,10]` gap5 → brain 12 `thinking` + `03:12` mono 12/600 `thinking`）+ **ConnChip**（ConnDot 8 `tool` + `live` mono 10.5 `text-muted`）。
- **MobBody** `JSnl5`（v `padding [12,14,6,14]` gap9 height fill）:
  - **TrainerCard** `I1UVXz`（radius8 fill `accent-soft`, 左線 `{left:2} $accent`, `padding [11,14]` gap7, v）:
    - ReqHead: `TRAINER` mono 10/700 `accent-strong` LS1.4 + spacer + `EPOCH 3 · 出題` mono 10 `text-muted` LS0.4。
    - ReqText `ECサイトの注文システムを設計せよ。マイクロサービス構成と ER 図を示すこと。` Inter 13.5/500 `text-primary` LH1.55。
    - ReqMeta `▸ system prompt · 8.2k chars` mono 10 `text-muted`。
  - **ThinkingBlock** `CXKQF`（radius8 fill `thinking-soft` 左線`{left:2} $thinking` `padding [10,13]` gap5）:
    - head: brain 13 `thinking` + `thinking` mono 11/600 `thinking` + spacer + **grip-vertical 14 `thinking` opacity0.45**（ドラッグハンドル）。
    - body `注文・在庫・決済を分離し、在庫は Saga の結果整合で扱うのが要点だ…` Inter 12.5/italic `text-secondary` LH1.6。
  - **FunctionCallsBlock** `i70Yz`（radius8 fill `tool-soft` 左線`{left:2} $tool` `padding [10,13]` gap7）:
    - head: terminal 13 `tool` + `function_calls` mono 11/600 `tool` + spacer + ParallelPill（zap10 `warn` + `並列 ×2` Inter 10.5/600, fill `surface` 枠1）。
    - **Invoke-1** `QNtlV` / **Invoke-2** `mhG5c`（radius6 fill `surface` 枠1 `padding [7,10]` gap2, v）— XML 構文をハイライト表示:
      - Open 行: `<invoke name=` mono10.5 `tool` + `"write_doc"` mono10.5/600 `$xml` + `>` `tool`。
      - Param 行(`padding-left 10`): `<parameter name=` `text-muted` + `"path"` `$xml` + `>` `text-muted` + **値** `text-secondary` + `</parameter>` `text-muted`（すべて mono10）。
      - Close: `</invoke>` mono10.5 `tool`。
      - Invoke-1 値 `architecture.md` / Invoke-2 値 `er-diagram.mmd`（PNG より）。
  - **FinalBlock** `wtRW4`（v gap6 padding2）:
    - FinalHead: FinalDot ellipse 6 `$accent` + `FINAL` mono 9/700 `text-muted` LS1.4。
    - FinalText `API Gateway 配下に注文・在庫・決済の3サービス。在庫は Saga で結果整合とする。` Inter 13 `text-primary` LH1.55。
    - **MermaidCard** `ctDV3`（radius6 fill `surface` 枠1 `padding [8,11]` gap2, v）: MerHead(` ```mermaid ` mono10.5 `text-muted` + spacer + copy 12 `text-muted`) + `erDiagram` mono10.5/600 `$xml` + 3 行 mono10.5 `text-secondary` LH1.5（`  CUSTOMER ||--o{ ORDER : places` / `  ORDER ||--|{ ORDER_ITEM : has` / `  PRODUCT ||--o{ ORDER_ITEM : in`）+ ` ``` ` `text-muted`。
- **InsertToolbar** `bjxlz`（h `padding [9,12]` gap7 fill `surface` 上線`{top:1}`, clip, 横スクロール）: plus 18 `$accent` + 5 pill（radius999 `padding [8,12]` gap6, lucide14 + Inter 12.5/600, 機能色 fill）: `Thinking`(thinking-soft) / `Tool`(tool-soft) / `XML`(xml-soft) / `Mermaid`(surface2, アイコン `xml`) / `Code`(surface2, braces `text-secondary`)。
- **MobBar** `Zdves`（v fill `surface` `padding [10,14,6,14]` gap8 上線）:
  - **BtnRow** `oaaZ7`（h gap10 fill）: ProgressBtn `nlufp`（枠 `border-strong`, radius8 `padding [12,16]` → activity15 + `途中経過` Inter13/600 `text-secondary`）+ **SendBtn** `B5htw`（**width fill**, radius8 fill `$accent`, justify center `padding [13,0]` → `送信` Inter 14.5/700 `on-accent` + arrow-up16）。
  - **HomeIndicator** `Bxrh1`: 134×5 radius999 fill `border-strong`。

### 3.6 Mobile Step 2（`cUfSM`, 390×844, radius28）

ルート: v-frame, fill `$bg`, clip。子 = M-Header + M-History + M-EditorWrap + M-BottomBar。
- **M-Header** `Yg052`（h `padding [16,16,12,16]` gap8 下線）: LogoDot 8 + `human-1` Fraunces 16/600 + spacer(fill) + **M-TurnChip**（radius999 枠1 `border-strong` `padding [4,10]` → `TURN 4 · STEP 2` mono 10 `text-secondary` LS0.5）+ M-LiveDot ellipse 7 `tool`。
- **M-History** `DohcU`（v `padding [12,16]` gap10 height fill, clip）:
  - **M-TrainerCard** `XuXrj`（radius8 fill `accent-soft` 左線`{left:2} $accent` `padding [10,14,11,14]` gap7）: head（`TRAINER · EPOCH 3` mono10/600 `accent-strong` LS1.2 + spacer + chevron-down 14 `text-muted`）+ 本文 `EC注文システム設計の課題 — 全体アーキテクチャと ER 図を含めること。図は Whiteboard で作成し…` Inter 13 `text-primary` LH1.55。
  - **M-YouCard** `SqSD8`（radius8 fill `surface2` 左線`{left:2} $border-strong` `padding [10,14,11,14]` gap8）:
    - head: `YOU · STEP 1` mono10/600 `text-muted` LS1.2 + check 12 `tool` + spacer + chevron-down 14 `text-muted`。
    - think: brain 12 `thinking` + `在庫と決済の整合性を確認。まず既存スキーマを…` Inter 12.5/italic `text-secondary`。
    - chips: M-Chip ×2（radius6 fill `surface` 枠1 `border-strong` `padding [3,8]` gap5 → 名前 mono10.5 `text-primary` + check 11 `tool`）: `exec_command` / `web_search`。
  - **M-Result-exec_command** `PskZ3` / **M-Result-web_search** `mPwv1`（radius8 fill `tool-soft` 左線`{left:2} $tool` `padding [10,14,11,14]` gap7）:
    - head: lucide12（terminal/search）`tool` + 名前 mono 11/600 `text-primary` + `· exit 0 · 0.4s`（web は `· 5 results · 1.2s`）mono10 `text-muted` + spacer + **NEW バッジ**（radius4 fill `surface` `padding [2,6]` → `NEW` mono 9/600 `tool` LS0.8）。
    - prev（radius6 fill `surface` 枠1 `padding [7,10]`）: 本文 mono 10.5 `text-secondary` LH1.5。exec=`schema.sql · 42 lines\nCREATE TABLE orders (id uuid PRIMARY KEY, …`。web=`Saga pattern — microservices.io\nOrchestration vs. choreography, compensating tx …`（PNG より）。
  - **M-Banner** `Yg1sV`（radius8 fill `accent-soft` `padding [9,12]` gap8, **左線なし**）: inbox 14 `accent-strong` + `tool_result ×2 を受信 — step 2 を開始` Inter 12/600 `accent-strong`。
- **M-EditorWrap** `cxapF`（v `padding [2,16,12,16]`）:
  - **M-Editor** `yRNdv`（radius8 fill `surface` 枠1 `border` `padding [14,14,12,14]` gap12, v）:
    - M-CaretRow `X9qKiH`: Caret 2×18 `$accent` + `結果を踏まえて続きを書く…` Inter 13.5 `text-muted`。
    - M-EdSpace 空 height56（入力エリア）。
    - **M-QuickRow** `xaiGF`（h gap6）: 3 pill（radius999 枠1 `border-strong`, fill なし, `padding [6,9]` gap5, lucide12 + Inter12/500）: `+ Thinking`(brain `thinking`) / `+ Tool call`(terminal `tool`) / `final を書く`(→ arrow-right, `text-secondary`)。
- **M-BottomBar** `lvHZ2`（v fill `surface` `padding [10,16,8,16]` gap10 上線）:
  - M-Btns `fmE6N`（h gap10 fill）: M-ProgressBtn `hFS4R`（枠 `border-strong` radius6 `padding [11,16]` → activity14 + `途中経過` Inter13/600 `text-secondary`）+ **M-SendBtn** `MiNVQ`（**width fill, disabled**: radius6 fill `surface3` justify center `padding [12,0]` → `送信` Inter 13.5/600 `text-muted` + arrow-up14 `text-muted`）。
  - M-HomeRow: HomeIndicator 120×5 radius3 fill `text-primary`（※ Mobile Answer は 134×5 `border-strong`。端末バーの色/幅は 2 画面で異なる — 実装は共通化せず PNG 準拠）。

---

## 4. 状態の意味づけ（preview fixture 用）

| 画面 | ターン/ステップ | UI が示すアプリ状態 |
|---|---|---|
| Flow1 (`x03Nex`) | turn 4 / step 1 送信直後 | 人間が step1（thinking + 並列 exec_command/web_search）を送信済み。harness がツール実行中。エディタは read-only、ツールバー非活性、右下「結果を待機中…」、StatusStrip に `0:04` 経過。RequestCard タイマー `—:—`（step 未計測）。**fixture: `phase=awaiting_tool_results`, editorLocked=true**。 |
| Flow2 (`pvtJF`) | turn 4 / step 2 開始 | tool_result ×2 到着済み、エディタをリセットし step2 を書き始める直前。RequestCard に過去の step1（折り畳み system/tools + trainer + YOU step1 + tool_result ×2）。エディタ空（プレースホルダ+クイックスタート3種）、Stepper が step2=作成中、送信ボタン disabled、`下書きなし`。タイマー計測中 `00:07`（thinking 色）。**fixture: `phase=composing_step2`, draftEmpty=true, stepper=[sent,tools_done,active]**。 |
| Whiteboard (`LhRGm`) | turn 4 | Workspace の Whiteboard タブ。ノード7個（3 service + DB + ER + class + memo）を配置済み、`Mermaid として挿入` で本文添付可。`ノード 7 · 自動保存`。**fixture: `tab=whiteboard`, nodes=7`**。 |
| Runs (`uG2hZ`) | epoch 7 | run #12「ECサイト設計」選択中の分析ビュー。7 run のリスト、学習曲線(ep1..7=2.5→8.5)、統計4、ロールアウト timeline(turn34–39, turn38 選択)、ルーブリック4項目+total。**fixture: `selectedRun=12`, epochs=7**。 |
| Mobile Answer (`j9b5n`) | turn（epoch 3） | モバイル1カラムで 1 ターン完全回答（trainer→thinking→function_calls(write_doc×2)→final+mermaid ER）。送信 active。**fixture: `phase=ready_to_send`, blocks=[thinking,tools,final]`**。 |
| Mobile Step2 (`cUfSM`) | turn 4 / step 2 | モバイル step2。履歴（trainer/you step1/tool_result ×2/受信 banner）+ 下部エディタ（プレースホルダ+クイック3）。送信 disabled。**fixture: `phase=composing_step2`, draftEmpty=true`**。 |

---

## 5. 抽出できなかった / 曖昧だった箇所

1. **CLAUDE.md とのトークン不一致**（最重要）: フォント（Space Grotesk→**Fraunces**）と機能色（鮮やか→**暖色ミュート**）が異なる。正とするフレームは Style C。M3 は本書=Style C を採用。CLAUDE.md の記述を更新するか要確認。
2. **Runs リスト非選択行の StatusDot 色**: 実測ツリーで全 TitleRow を展開していない（選択行 `ECサイト設計` のみ `$accent` 確認）。他行の dot 色は **PNG 準拠**で記載（通知配信=くすんだ赤茶/`$warn` 相当、他=`$tool` 緑）。厳密値は要再測定。
3. **Whiteboard RequestCard（`kAE5F`/`wHaNz`）の内部**: Flow1 の RequestCard と同型と判断し詳細を割愛。timer 表示値（`—:—` か計測中か）は未確認 — 実装前に batch_get 推奨。
4. **Mobile Answer Invoke-2（`mhG5c`）と Mobile Step2 の web_search 系（`ynYGs`/`HCne1`）**: readDepth 内で展開せず、内容は PNG と Invoke-1 の構造から推定記載（Invoke-2 値=`er-diagram.mmd`、web_search body=`Orchestration vs. choreography, compensating tx …`）。構造は Invoke-1 / exec_command result と同一。
5. **shader フィル**: Whiteboard キャンバス背景は WebGL シェーダ `dotgrid.glsl`（uniforms 実値記載）。React 実装では等価な CSS radial-gradient / canvas でドットグリッド（spacing24, dot `#CFC4AD`, bg `#FCFAF5`, 半径 1.1）を再現するか、shader をそのまま移植するか要判断。
6. **HomeIndicator の不一致**: Mobile Answer=134×5 `border-strong`、Mobile Step2=120×5 `text-primary`。意図的差か不明。PNG 準拠。
7. **Bars 高さの算出式**: 学習曲線バーは概ね `値 × 15px`（ep1=2.5→37.5 実測一致）。他バーは高さ実測値を未取得だが同式で導出可（height150 コンテナ内）。Spark（Runs リスト）の各 bar 高さは実測値を §3.4 の元データで確認済み（4.8〜20.4 の範囲、正規化）。
8. **dark テーマ描画**: 全フレームは light のみ。dark は変数値からの機械適用で、実際の dark レイアウト検証フレームは存在しない。
