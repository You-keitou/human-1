---
paths:
  - "design/**"
  - "scripts/**"
---

# Pencil / px 基準の作法

- `.pen` ファイルは暗号化されており Read / Grep 不可 — pencil MCP ツールのみで扱う
- 正はコミット済みの `design/reference/html/*.html`(Pencil 忠実 export)。更新は Pencil エディタで `human-1.pen` を開いた状態で export_html を依頼
- 基準 PNG はコミットしない: `bun run refs:generate` が HTML から毎回 Chromium で再生成する(環境固有の偽 FAIL 防止)。比較は `bun run verify:pixels`
- 手順・来歴・macOS 固定の注意は `docs/testing.md` が正
