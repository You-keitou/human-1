import { defineConfig, devices } from '@playwright/test'

// human-1 の E2E は chromium のみ(仕様)。UI は packages/ui の Vite dev サーバーを
// Playwright が起動して検証する。M3 で SPA 化しても webServer 連携はそのまま使える。
const PORT = 5199
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: './artifacts/playwright',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun run dev',
    cwd: 'packages/ui',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
