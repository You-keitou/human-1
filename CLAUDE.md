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
- UI トークン: フォント Space Grotesk / Inter / JetBrains Mono。機能色(light): thinking `#7C3AED`・tool `#0B9F66`・XML `#0369A1`・score `#0D9488`

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

## マイルストーン

- [x] M0: 設計合意・Pencil モック(`design/human-1.pen`)
- [x] M1: モノレポ scaffold + shared(型・パーサ移植。並列複数 tool call 対応で `ParsedTurn.toolCalls` は配列)
- [x] M2: server(Workers + DO、両 API、WS、認証、永続化、並列 tool call。統合テスト 36 件=人間シミュレータ方式)
- [ ] M3: ui(エディタ移植・デザイン一新・Runs・モバイル)
- [ ] M4: cli(`hllm`)
- [ ] M5: deploy + 実機 E2E(codex / claude 両殻)

## 検証の作法

- 基本コマンド: `bun test` / `bun run typecheck` / `bun run check`(Biome)/ `bun run e2e`(Playwright + chromium)
- UI は Pencil モックと px 単位一致が必須: `bun run verify:pixels`(strict、基準 PNG は `design/reference/`。欠如は FAIL)。基準未生成の間だけ `verify:pixels:bootstrap`。基準の書き出しは Pencil エディタで `human-1.pen` を開いた状態で Claude に依頼(手順は `docs/testing.md`)
- テストの実装と検証は別々の sub-agent に依頼し、コミット前に codex の第三者レビュー(APPROVE)を必須とする

- サーバーの E2E は「人間シミュレータ」(WS クライアントで自動回答)を使う。PoC の `driver/human-sim*.mjs` を参照
- 殻を伴う統合テストは `codex exec --profile <profile>` / `claude -p --model human` のヘッドレスで行い、TUI 検証は node-pty で画面バッファを capture する
