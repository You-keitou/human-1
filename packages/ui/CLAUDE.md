# packages/ui — デザインと検証

- UI デザインの正は Pencil の **Style C(Atelier Warm)系 6 フレーム**(ユーザー決定)。トークン実値は `docs/design-spec.md` が正: フォント Fraunces(display)/ Inter / JetBrains Mono、機能色(light): thinking `#7B4A68`・tool `#5C7050`・XML `#40676B`
- **px 単位一致が必須**: `bun run verify:pixels`(結合ゲート = 基準再生成→比較)。正はコミット済みの `design/reference/html/*.html`(Pencil 忠実 export)。基準 PNG はコミットせず毎回 Chromium で再生成する(コミット済み PNG は環境固有で偽 FAIL を生むため廃止)
- 基準 HTML の更新は Pencil エディタで `human-1.pen` を開いた状態で export_html を依頼(手順・来歴・macOS 固定の注意は `docs/testing.md`)
- **delta streaming の UI ボタンは出さない**(決定事項。プロトコル対応はサーバーに残っている)
