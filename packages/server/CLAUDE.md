# packages/server — 実装知見

## ルーティング・API 互換

- codex は `POST /v1/responses`、Claude Code は `POST /v1/messages?beta=true`(**クエリ付き** — ルーティングは pathname 比較)
- `/v1/models` は OpenAI 形式に加えて codex が期待する `models` キーを併記
- **裏方リクエストはサーバーが自動応答**して人間に届かせない: Claude Code のセッションタイトル生成(`<session>`+`Write the title`)と `[SUGGESTION MODE`、codex のメモリ生成(`Analyze this rollout`+`rollout_slug`)。検出は**最後の user メッセージのみ**を見る(claude 殻が cwd の CLAUDE.md を全リクエストに注入するため、会話全体を見ると誤判定する — 実際に事故った)

## SSE / ストリーム

- Anthropic SSE の thinking ブロックはダミー `signature_delta` を送って閉じる
- 人間は遅い: サーバータイムアウトは 30 分+thinking/delta で再武装
- DEFER: OpenAI SSE の `sequence_number` / `response.content_part.done` 等の完全正準化

## タイムアウトの終端設計

- クライアントに再試行させない形が必須(再試行=人間への二重出題)。非ストリームは両プロトコル形式の **400**(SDK は 408/409/429/5xx を自動再試行するため)、messages ストリームは `event: error`、**responses ストリームは `response.failed` 不可**(codex が retryable と解釈)— `[human-1] timeout:` 告知テキスト+`response.completed` の正常終了マスキングで閉じる
- タイムアウトの正準シグナルは WS `timeout` イベント(rejectPending は `answered` を出さないので rollout/score は汚染されない)
- WS 新規接続時は in-flight pending のスナップショットを再送する(スマホ再接続で宙に浮くのを防ぐ)。部分回答(delta 蓄積)の再送は未実装 — delta UI を出す時に要対応
