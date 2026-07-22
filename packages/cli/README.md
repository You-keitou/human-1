# hllm

CLI for [human-1](https://github.com/You-keitou/human-1) — an OpenAI/Anthropic API-compatible "LLM" powered by YOU, with an AI trainer that post-trains the human.

トレーナー AI がローカルの agent(codex / Claude Code)を殻として起動し、あなた(人間 LLM)に設計タスクを出題・採点します。回答はブラウザ(スマホ可)から「LLM として」返します。

## Install

```sh
npm install -g hllm
```

Requires Node.js >= 22 on macOS / Linux. The optional `node-pty` dependency enables TUI passthrough: `hllm free` falls back to headless mode without it, while `hllm train --tui` requires it (omit `--tui` for headless training).

## Usage

```sh
hllm login --server https://<your>.workers.dev --token <TOKEN>
hllm train "システム設計" --shell claude --epochs 3   # AI trainer poses tasks and scores you
hllm free "分散システム雑談" --shell codex            # score-free casual conversation mode
hllm theater                                          # watch all events in the terminal
```

You need your own [human-1 server](https://github.com/You-keitou/human-1) deployed on Cloudflare Workers. See the repository for setup, architecture, and the story behind it (inspired by [Syuparn/humanllm](https://github.com/Syuparn/humanllm)).

## License

MIT
