# human-1

**人間を事後学習する訓練環境。** OpenAI/Anthropic API 互換の「人間 LLM」サーバーで、トレーナー AI がローカルの agent(codex / Claude Code)を操作して人間に設計タスクを出題し、人間はブラウザから thinking・tool call・回答を「LLM として」返す。単一ユーザーの private 運用。public リポジトリ: https://github.com/You-keitou/human-1

## アーキテクチャ(確定済み)

```
☁️ Cloudflare Workers + Durable Object
   /v1/responses (OpenAI互換・codex用) + /v1/messages (Anthropic互換・Claude Code用)
   WebSocket(全イベント配信: request / thought / tool_called / answered)
   DO ストレージ: 訓練 run・rollout・スコアの永続化、UI 静的配信
   認証: 単一シークレットトークン(Bearer / UI は localStorage)

💻 ローカル: hllm CLI(トレーナー AI = claude -p、殻 = codex / claude を TUI 透過)
📱 ブラウザ = 人間 LLM(スマホ対応が cloud 化の主目的)
```

本番: **https://human-1.youkeitou327.workers.dev**(deploy は root の `bun run deploy`。トークンは `~/.config/hllm/deploy-token.txt`)

## モノレポ構成(bun workspaces)

- `packages/shared` — 型・Claude 方言の寛容パーサ
- `packages/server` — Workers + DO
- `packages/ui` — Vite + React SPA(tiptap エディタ / React Flow ホワイトボード / Runs)
- `packages/cli` — `hllm`(login / train / free / theater。npm: `@yangjingtao/hllm`)
- `design/human-1.pen` — Pencil モック(Style C 系 6 フレーム)
- `poc/` — 前身 PoC(Syuparn/humanllm フォーク+driver 群。知見は反映済み、参照用)

## 決定事項(変更には相談が必要)

- **パッケージ管理・テストランナーは bun**。npm / yarn は使わない。**CLI(hllm)の実行ランタイムのみ Node** — bun の pty バグで TUI 透過が動かないため(詳細は `packages/cli/CLAUDE.md`)
- response の準拠範囲: thinking / **並列複数 tool call** / tool 結果後の継続 thinking / final。**delta streaming の UI ボタンは出さない**(プロトコル対応はサーバーに残す)
- 人間の出力記法は **Claude 方言に統一**: `<thinking>…</thinking>`、`<function_calls><invoke name="X"><parameter name="y">…</parameter></invoke></function_calls>`、タグ外テキスト = final。パーサは寛容(崩れタグは警告して本文扱い)
- ホワイトボードは React Flow + カスタムノード → Mermaid に変換してエディタへ挿入(人間の最終出力はテキスト)
- トレーナーの採点は `[SCORE: x.x/10]` タグ必須。学習曲線として永続化
- UI デザインの正は Pencil **Style C(Atelier Warm)**。トークン実値は `docs/design-spec.md` が正(詳細は `packages/ui/CLAUDE.md`)

## 検証の作法(大原則)

- 基本コマンド: `bun test` / `bun run typecheck` / `bun run check`(Biome)/ `bun run e2e` / `bun run verify:pixels`(UI は Pencil モックと px 単位一致が必須)
- **テストの実装と検証は別々の sub-agent に依頼し、コミット前に codex の第三者レビュー(APPROVE)を必須とする**

## 詳細知見の置き場所(必要時に自動ロード)

- `packages/server/CLAUDE.md` — プロトコル互換・裏方リクエスト・SSE・タイムアウト設計
- `packages/cli/CLAUDE.md` — ランタイム/配布・トレーナー・rollout 相関・codex/claude 殻の癖
- `packages/ui/CLAUDE.md` — デザインの正・px 一致ゲート
- `.claude/rules/` — テスト・Pencil の作法(paths 指定で該当作業時のみロード)
- `ROADMAP.md` — マイルストーン(M0–M5 完了、M6 Whiteboard 拡充、M7 出題者ペルソナ)と backlog
