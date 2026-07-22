---
paths:
  - "e2e/**"
  - "packages/*/test/**"
  - "**/*.test.ts"
  - "**/*.spec.ts"
---

# テストの作法

- サーバーの E2E は「人間シミュレータ」(WS クライアントで自動回答)を使う。`poc/driver/human-sim*.mjs` を参照
- CLI の自動テストは**フェイク殻**(`HLLM_FAKE_CLAUDE` / `HLLM_FAKE_CODEX`)を使う。実殻(`codex exec --profile <profile>` / `claude -p --model human` のヘッドレス)での検証は実機 E2E(M5 方式・手動)で行う
- TUI の自動検証は未整備(M5 では node-pty で画面バッファを capture する手動検証を実施)。自動化する場合はこの方式を踏襲する
- CLI のテストは Node(tsx)で殻・ランチャを起動する(bun 実行では pty が動かない)
- 大原則(ルート CLAUDE.md): テストの実装と検証は別々の sub-agent、コミット前に codex APPROVE 必須
