# human-1

OpenAI/Anthropic API-compatible LLM powered by YOU — 人間を事後学習するための訓練環境。

- `packages/server` — Cloudflare Workers + Durable Object(API互換・WS中継・永続化)
- `packages/ui` — 人間LLM用ワークスペース(raw出力エディタ / ホワイトボード / Runs)
- `packages/cli` — `hllm`(trainer AI + 殻の起動)
- `packages/shared` — 型・Claude方言パーサ
- `design/` — Pencil デザインファイル

