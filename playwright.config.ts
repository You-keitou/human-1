import { defineConfig, devices } from '@playwright/test'

// human-1 の E2E は chromium のみ(仕様)。UI は packages/ui の Vite dev サーバーを
// Playwright が起動して検証する。M3 第 2 段(UI 機能配線)の実機能 e2e では、
// vite に加えて wrangler dev(実サーバー)も webServer で起動し、実 WS / REST を通す。
//   - vite(:5199)…… /v1・/api・/ws を wrangler(HUMAN1_API_ORIGIN)へプロキシ
//   - wrangler(:8791)… 実 DO。globalSetup で DO 状態を消してから起動するので毎回クリーン
// Playwright は node で走る(bin シェバンが node)ため、bun 専用の server テストヘルパは
// import できない。wrangler の起動は webServer に任せる(node 管理の子プロセス)。
const PORT = 5199
const BASE_URL = `http://localhost:${PORT}`
const API_PORT = 8791
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: './artifacts/playwright',
  timeout: 45_000,
  // DO 状態の初期化と API ポートの解放(前回残りの workerd を掃除)。
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // wrangler(:8791)は globalSetup が起動する(webServer 管理下だと TTY 無しで bind に失敗するため)。
  // vite(:5199)のみ webServer で起動し、/v1・/api・/ws プロキシ先を e2e の wrangler に向ける。
  webServer: {
    command: 'bun run dev',
    cwd: 'packages/ui',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { HUMAN1_API_ORIGIN: API_ORIGIN },
  },
})
