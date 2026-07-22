# packages/cli — 実装知見

## ランタイム・配布

- 実行ランタイムは **Node**。bun の pty バグ(1.2 は ENXIO、1.3.14 もデータが流れない)で node-pty が不動作のため。`bin/hllm` ラッパが実行を隠蔽: workspace 内(src あり)は tsx、公開 tarball(dist のみ)は素の Node
- npm パッケージ名は **`@yangjingtao/hllm`**(unscoped `hllm` は npm の類似名保護 `htm`/`mlly` で拒否)。コマンド名は `hllm`。`engines.node >=22`(グローバル `WebSocket` 使用のため)、`os: darwin/linux`。`prepack` = `bun build` で shared をバンドル(node-pty のみ external・optionalDependencies)
- TUI 透過は Node 実行時のみ。`free` は node-pty 欠落時ヘッドレスにフォールバック、`train --tui` は node-pty 必須
- 殻の信頼ダイアログへの自動応答は codex/claude とも **Enter**(codex に「2」を送ると No,quit になる)。TUI 注入は殻の composer 到達前だと遅延しうる(waitReady の composer 検出は今後の改善)

## トレーナー

- トレーナー AI = `claude -p --system-prompt`(サブスク認証・API キー不要)。**子環境から ANTHROPIC_API_KEY 等を除去必須**(サブスク認証が API キー課金化するのを防ぐ)
- `claude -p --resume` は毎回新 session_id に fork する(返却された最新 ID を追跡)
- タイムアウトは WS `timeout` イベント(+`[human-1] timeout:` マーカー)で検出。空回答として誤採点しない

## rollout 相関・殻管理

- 相関は**マーカー方式**: `[hllm:rollout:<id>]` を出題末尾に注入し、messages にマーカーを含む request のみ帰属(ツール連鎖は会話履歴で追従、不確実なら fail-closed=誤採点しない)。**実機で PASS 済み**(実 codex のツール連鎖 2 発目もマーカー保持)。マーカーは人間に可視 — 隠しメタデータ化は ROADMAP の backlog
- 殻は ShellHandle {promise, kill} で管理: WS 終端と子プロセス失敗を race し、**どちらが勝っても非ゼロ終了は rollout 失敗**(採点スキップ)。join は 30s+kill 後 5s の有界
- exit code: 殻失敗があれば 1(訓練は続行)、人間タイムアウトは非致命で 0。rollout の score なし終端は `POST /api/rollouts/:id/end`

## codex 殻の癖(0.144.6 時点)

- プロファイルは `~/.codex/<name>.config.toml` 別ファイル方式。認証キーは **`env_key`**(旧 `bearer_token_env_var` は未認識で 401)。codex 側の背景知識: シェルツール名は `exec_command`({cmd})、設定フィールドの手動デバッグには `--strict-config` が有用(いずれも CLI 実装は未使用)
- `model_supports_reasoning_summaries = true` でも reasoning summaries が無効(`reasoning summaries: none`)。**制約として受容** — thinking はサーバー/UI には流れる。codex 更新のたび再検証(ROADMAP backlog)
- 人間は遅い: `stream_idle_timeout_ms` を延長する

## claude 殻の癖

- **cwd の CLAUDE.md を全リクエストに注入する**。裏方検出リテラルを含むファイルが cwd にあると誤判定事故が起きる。対策(二重): 殻は既定で中立一時 cwd 起動(`--cwd` 明示で上書き、`--keep-workdir` で保持)+ server の裏方検出は最後の user メッセージのみ
