---
paths:
  - "e2e/**"
  - "packages/*/test/**"
  - "**/*.test.ts"
  - "**/*.spec.ts"
---

# テストの作法

- サーバーの E2E は「人間シミュレータ」(WS クライアントで自動回答)を使う。`poc/driver/human-sim*.mjs` を参照
- 殻を伴う統合テストは `codex exec --profile <profile>` / `claude -p --model human` のヘッドレスで行い、TUI 検証は node-pty で画面バッファを capture する
- CLI のテストは Node(tsx)で殻・ランチャを起動する(bun 実行では pty が動かない)
- 大原則(ルート CLAUDE.md): テストの実装と検証は別々の sub-agent、コミット前に codex APPROVE 必須
