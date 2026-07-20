# human-1

**人間を事後学習する訓練環境。** OpenAI/Anthropic API 互換の「人間 LLM」サーバーで、トレーナー AI がローカルの agent(codex / Claude Code)を操作して人間に設計タスクを出題し、人間はブラウザから thinking・tool call・回答を「LLM として」返す。単一ユーザーの private 運用。

前身の PoC は `../human-llm/`(Syuparn/humanllm のフォーク+driver 群)。動作検証済みの知見はそこから移植する。

## アーキテクチャ(確定済み)

```
☁️ Cloudflare Workers + Durable Object
   /v1/responses (OpenAI互換・codex用) + /v1/messages (Anthropic互換・Claude Code用)
   WebSocket(全イベント配信: request / thought / tool_called / answered)
   DO ストレージ: 訓練 run・rollout・スコアの永続化
   UI 静的配信(Workers Assets)
   認証: 単一シークレットトークン(Bearer / UI は localStorage)

💻 ローカル: hllm CLI
   トレーナー AI = claude -p --system-prompt(サブスク認証・API キー不要)
   殻(codex / claude)を node-pty で起動し TUI 透過、プロンプト注入
   回答検出はサーバーの WS 'answered' イベント購読(セッション JSONL の tail は使わない)

📱 ブラウザ = 人間 LLM(スマホ対応が cloud 化の主目的)
```

## モノレポ構成(bun workspaces)

- `packages/shared` — 型・Claude 方言の寛容パーサ(`<thinking>` / `<function_calls><invoke>`)
- `packages/server` — Workers + DO
- `packages/ui` — Vite + React SPA(tiptap エディタ / React Flow ホワイトボード / Runs)
- `packages/cli` — `hllm`(login / train / theater)
- `design/human-1.pen` — Pencil モック(4画面、ライトモード基調・mode テーマ両対応)

## 決定事項(変更には相談が必要)

- **パッケージ管理は bun**。npm / yarn は使わない
- response の準拠範囲: thinking / **並列複数 tool call** / tool 結果後の継続 thinking / final。
  **delta streaming の UI ボタンは出さない**(プロトコル対応はサーバーに残す)
- 人間の出力記法は **Claude 方言に統一**: `<thinking>…</thinking>`、`<function_calls><invoke name="X"><parameter name="y">…</parameter></invoke></function_calls>`、タグ外テキスト = final。パーサは寛容(崩れタグは警告して本文扱い)
- ホワイトボードは React Flow + カスタムノード(付箋・サービス・DB・ER エンティティ・クラス)→ Mermaid `graph` / `erDiagram` / `classDiagram` に変換してエディタへ挿入
- トレーナーの採点は `[SCORE: x.x/10]` タグ必須。学習曲線として永続化
- UI デザインの正は Pencil の **Style C(Atelier Warm)系 6 フレーム**(ユーザー決定)。トークン実値は `docs/design-spec.md` が正: フォント Fraunces(display)/ Inter / JetBrains Mono、機能色(light): thinking `#7B4A68`・tool `#5C7050`・XML `#40676B`(旧記述の Space Grotesk・`#7C3AED` 等は Style C 採用により廃止)

## PoC からの重要な知見(ハマりどころ)

- codex は `POST /v1/responses`、Claude Code は `POST /v1/messages?beta=true`(**クエリ付き** — ルーティングは pathname 比較)
- Claude Code の裏方リクエスト(セッションタイトル生成 `<session>`+`Write the title`、`[SUGGESTION MODE`)と codex のメモリ生成(`Analyze this rollout`+`rollout_slug`)は**サーバーが自動応答**して人間に届かせない
- thinking を codex TUI に表示させるには profile 設定 `model_supports_reasoning_summaries = true` が必要。太字1行目がスピナー横の見出しになる
- Anthropic SSE の thinking ブロックはダミー `signature_delta` を送って閉じる
- codex 0.144+ のプロファイルは `~/.codex/<name>.config.toml` 別ファイル方式。シェルツール名は `exec_command`({cmd})
- 人間は遅い: サーバータイムアウトは 30 分+thinking/delta で再武装。codex 側は `stream_idle_timeout_ms` を延長
- `claude -p --resume` は毎回新 session_id に fork する(返却された最新 ID を追跡)

## M2 実装知見(server)

- タイムアウトの終端はクライアントに再試行させない形が必須(再試行=人間への二重出題)。非ストリームは両プロトコル形式の **400**(SDK は 408/409/429/5xx を自動再試行するため)、messages ストリームは `event: error`、**responses ストリームは `response.failed` 不可**(codex が retryable と解釈)— `[human-1] timeout:` 告知テキスト+`response.completed` の正常終了マスキングで閉じる。タイムアウトの正準シグナルは WS `timeout` イベント(rejectPending は `answered` を出さないので rollout/score は汚染されない)
- **M4 への申し送り**: トレーナーはタイムアウトを WS `timeout` イベント(+`[human-1] timeout:` マーカー)で検出すること。空回答として誤採点しない
- WS 新規接続時は in-flight pending のスナップショットを再送する(スマホ再接続で宙に浮くのを防ぐ)。部分回答(delta 蓄積)の再送は未実装 — delta UI を出す時に要対応
- DEFER: OpenAI SSE の `sequence_number` / `response.content_part.done` 等の完全正準化

## M4 実装知見(cli)

- rollout と WS イベントの相関は**マーカー方式**: `[hllm:rollout:<id>]` を出題末尾に注入し、messages にマーカーを含む request のみ帰属(ツール連鎖は会話履歴で追従、無関係リクエストは排除、不確実なら fail-closed=誤採点しない)。マーカーは人間に可視 — 隠しメタデータ相関への移行は将来課題
- 殻は ShellHandle {promise, kill} で管理: WS 終端と子プロセス失敗を race し、**どちらが勝っても非ゼロ終了は rollout 失敗**(採点スキップ)。join は 30s+kill 後 5s の有界
- exit code: 殻失敗があれば 1(訓練は続行)、人間タイムアウトは非致命で 0。rollout の score なし終端は `POST /api/rollouts/:id/end`
- node-pty は bun 1.2 で ENXIO のため **train はヘッドレスが既定**(--tui は node ランタイム向けに温存)
- トレーナー子環境から ANTHROPIC_API_KEY 等を除去必須(サブスク認証が API キー課金化するのを防ぐ)
- M5 で要検証(codex DEFER): 実 codex/claude のツール連鎖が履歴にマーカーを保持するか、実 codex の JSON 出力形式、取りこぼしたマーカー付き request の replay

## マイルストーン

- [x] M0: 設計合意・Pencil モック(`design/human-1.pen`)
- [x] M1: モノレポ scaffold + shared(型・パーサ移植。並列複数 tool call 対応で `ParsedTurn.toolCalls` は配列)
- [x] M2: server(Workers + DO、両 API、WS、認証、永続化、並列 tool call。統合テスト 36 件=人間シミュレータ方式)
- [ ] M3: ui(エディタ移植・デザイン一新・Runs・モバイル)
- [x] M4: cli(`hllm` login / train / theater。テスト 44 件=フェイク殻+実サーバー E2E)
- [ ] M5: deploy + 実機 E2E(codex / claude 両殻)

## 検証の作法

- 基本コマンド: `bun test` / `bun run typecheck` / `bun run check`(Biome)/ `bun run e2e`(Playwright + chromium)
- UI は Pencil モックと px 単位一致が必須: `bun run verify:pixels`(結合ゲート = 基準再生成→比較)。**正はコミット済みの `design/reference/html/*.html`(Pencil 忠実 export)**で、基準 PNG はコミットせず毎回 Chromium で再生成する(コミット済み PNG は環境固有で偽 FAIL を生むため廃止)。HTML の更新のみ Pencil エディタで `human-1.pen` を開いた状態で Claude に export_html を依頼(手順・来歴・macOS 固定の注意は `docs/testing.md`)
- テストの実装と検証は別々の sub-agent に依頼し、コミット前に codex の第三者レビュー(APPROVE)を必須とする

- サーバーの E2E は「人間シミュレータ」(WS クライアントで自動回答)を使う。PoC の `driver/human-sim*.mjs` を参照
- 殻を伴う統合テストは `codex exec --profile <profile>` / `claude -p --model human` のヘッドレスで行い、TUI 検証は node-pty で画面バッファを capture する
