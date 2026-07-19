# poc/ — 検証済みプロトタイプ(アーカイブ)

2026-07-19 の PoC 一式。本実装(packages/)の参照実装として保存している。**ここのコードは今後編集しない**。移植元として読むだけ。

## 中身

- `humanllm/` — Syuparn/humanllm のフォーク+拡張。動作検証済み:
  - `server/api/responses-node.ts` — OpenAI Responses API(codex 用)。reasoning ストリーム・並列前の単発 tool call・裏方リクエスト自動応答・30分再武装タイムアウト
  - `server/api/messages-node.ts` — Anthropic Messages API(Claude Code 用)。thinking ブロック・ダミー signature_delta・タイトル生成/サジェストの自動応答
  - `server/store/pendingRequests.ts` + `server/ws/handler.ts` — WS イベント配信(request / thought / tool_called / answered)
  - `src/components/RichResponseInput.tsx` — tiptap の Claude 方言エディタ(`<thinking>` input rule・`/` スラッシュメニュー・寛容パーサ `parseRawOutput`)
  - `src/components/DiagramEditor.tsx` — React Flow → Mermaid 変換
  - `src/components/ResponseWorkspace.tsx` / `PromptDisplay.tsx` — タブ構造・XML 整形表示
- `driver/` — ローカル駆動スクリプト(hllm CLI の前身):
  - `training.mjs` — 事後学習ループ(rubric → rollout → 採点 → 教師データ → 学習曲線)。MEDIUM/TRAINER 切替
  - `theater.mjs` / `theater-claude.mjs` — 自由対話版(codex 殻 / Claude Code 殻)
  - `human-sim.mjs` / `human-sim-tool.mjs` — 人間シミュレータ(E2E 検証用 WS クライアント)
  - `*-log.md` — 実際の実行ログ(トレーナーの講評・総評の実例)

## リポジトリ外の設定(再現に必要)

- `~/.codex/humanllm.config.toml` — codex プロファイル(model="human", base_url, `model_supports_reasoning_summaries=true`, `stream_idle_timeout_ms=1800000`)
- `~/.codex/config.toml` — playground の trust_level 追記
- Claude Code は env のみ: `ANTHROPIC_BASE_URL=http://localhost:3000 ANTHROPIC_AUTH_TOKEN=dummy claude --model human`

## 動かし方(参考)

```bash
cd poc/humanllm && bun install && npm run dev   # UI :5173/5174, API :3000
cd poc/driver && bun install
node training.mjs "システム設計"                  # 事後学習ループ
node theater-claude.mjs "テーマ"                 # Claude Code 版劇場
```

注意: driver の node-pty は install 後に `chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` が必要な場合がある。
