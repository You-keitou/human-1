# human-1

**OpenAI/Anthropic API-compatible LLM powered by YOU — 人間を事後学習する訓練環境。**

ふつうの事後学習は「人間が AI を訓練する」。human-1 はその逆をやります。

- あなた(人間)が **LLM としてサーブされる**: OpenAI 互換 `/v1/responses` と Anthropic 互換 `/v1/messages` を持つサーバーが、届いたリクエストをブラウザに中継し、あなたが thinking・tool call・回答を「LLM として」書いて返す
- **トレーナー AI があなたを訓練する**: `hllm train` がローカルの agent(codex / Claude Code)を殻として起動し、トレーナー AI(claude)が設計タスクを出題 → あなたの回答を採点(`[SCORE: x.x/10]`)→ 学習曲線として永続化
- スマホのブラウザからでも回答できます(Cloudflare Workers 上で動くので、外出先で「推論」できる)

単一ユーザーの private 運用を想定した、実用と冗談のあいだのプロジェクトです。

## 元ネタ・影響を受けたもの

本プロジェクトは [Syuparn](https://github.com/Syuparn) 氏の [humanllm](https://github.com/Syuparn/humanllm)("OpenAI API-compatible LLM powered by YOU", MIT License)と、その解説記事 Qiita「[【永久0円】人間LLMのすすめ](https://qiita.com/Syuparn/items/0001f93221d4d7556271)」(2026-06-29)の発想に強く影響を受けています。前身的な発想の「[MCPを肌で実感。俺がMCPサーバーだ](https://qiita.com/Syuparn/items/92417e0e0b3c67f8e205)」(2025-04-16)もあわせてどうぞ。

human-1 が humanllm に足したもの: Anthropic API 互換(Claude Code を殻にできる)、並列複数 tool call、Cloudflare Workers + Durable Object によるクラウド化(スマホ回答)、トレーナー AI による自動出題・採点・学習曲線、ホワイトボード(React Flow → Mermaid 変換)。

## しくみ

```
☁️ Cloudflare Workers + Durable Object
   /v1/responses (OpenAI互換・codex用) + /v1/messages (Anthropic互換・Claude Code用)
   WebSocket(全イベント配信: request / thought / tool_called / answered)
   訓練 run・rollout・スコアの永続化、UI 静的配信
   認証: 単一シークレットトークン

💻 ローカル: hllm CLI
   トレーナー AI = claude -p(サブスク認証・API キー不要)
   殻(codex / claude)を node-pty で起動して TUI 透過、プロンプト注入
   回答検出はサーバーの WS 'answered' イベント購読

📱 ブラウザ = 人間 LLM
   thinking / tool call / 回答を「LLM として」返すワークスペース
   (raw エディタ + ホワイトボード + 学習曲線)
```

## つかいかた

### 1. サーバーを自分の Cloudflare にデプロイ

```sh
bun install
bun run deploy   # ui build → packages/server/public → wrangler deploy
```

認証トークン(任意の長い文字列)を wrangler secret として設定してください(`packages/server` 参照)。

### 2. CLI

```sh
npm install -g @yangjingtao/hllm   # `hllm` コマンドが入る

hllm login --server https://<your>.workers.dev --token <TOKEN>
hllm train "システム設計" --shell claude --epochs 3   # トレーナー AI が出題・採点
hllm free "分散システム雑談" --shell codex            # 採点なしの自由対話モード
hllm theater                                          # ターミナルでイベントを観劇
```

`hllm train` が殻(codex / Claude Code)を起動すると、出題があなたのサーバーに届き、ブラウザ(スマホ可)に着信します。回答すると殻に流れ、トレーナーが採点します。

### 3. 人間の出力記法(Claude 方言)

ブラウザ側では Claude の出力方言で「LLM を演じ」ます。パーサは寛容で、崩れたタグは警告つきで本文扱いになります。

```
<thinking>まず要件を整理する…</thinking>
<function_calls><invoke name="exec_command"><parameter name="cmd">ls -la</parameter></invoke></function_calls>
タグ外のテキストが final answer になります。
```

## モノレポ構成

| パス | 内容 |
| --- | --- |
| `packages/server` | Cloudflare Workers + Durable Object(両 API・WS・永続化) |
| `packages/ui` | Vite + React SPA(tiptap エディタ / React Flow ホワイトボード / Runs) |
| `packages/cli` | `hllm`(npm パッケージ。login / train / free / theater) |
| `packages/shared` | 型・Claude 方言の寛容パーサ |
| `design/` | Pencil モック(UI は px 単位一致ゲートで検証) |
| `poc/` | 前身 PoC(Syuparn/humanllm のフォーク + driver 群) |

## 開発

```sh
bun test              # ユニット・統合テスト(サーバーは人間シミュレータ方式)
bun run typecheck
bun run check         # Biome
bun run e2e           # Playwright
bun run verify:pixels # UI と Pencil モックの px 一致ゲート
```

パッケージ管理・テストは bun、CLI の実行ランタイムのみ Node(bun の pty 制約のため)。詳細は `docs/` と `CLAUDE.md` を参照。

## ロードマップ

Whiteboard の図種拡充(シーケンス図・状態遷移図)や出題者ペルソナ(意地悪な出題者など)を予定しています。詳細は [ROADMAP.md](ROADMAP.md) を参照。

## ライセンス

MIT(`poc/humanllm` はフォーク元 [Syuparn/humanllm](https://github.com/Syuparn/humanllm) の MIT ライセンス表記を保持しています)
