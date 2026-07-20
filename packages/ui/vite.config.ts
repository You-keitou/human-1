import { defineConfig } from 'vite'

// M3 で React SPA 化する前提の最小構成。E2E / px 検証がポートを固定できるよう
// dev / preview 双方で strictPort を有効にする(衝突時は黙って別ポートに逃がさない)。
const PORT = 5199

export default defineConfig({
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
})
