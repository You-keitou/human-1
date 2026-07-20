import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// M3: Vite + React SPA。E2E / px 検証がポートを固定できるよう dev / preview 双方で
// strictPort を有効にする(衝突時は黙って別ポートに逃がさない)。
const PORT = 5199

// dev では API/WS を wrangler dev(既定 8787)へプロキシし、ブラウザから見て同一オリジンにする
// (WS の同一オリジン制約を満たす)。プロキシは /v1・/api・/ws を叩いた時だけ発火するため、
// px 検証(/preview のみ)や e2e スモーク(/ のみ)には影響しない。上書きは HUMAN1_API_ORIGIN で。
const API_ORIGIN = process.env.HUMAN1_API_ORIGIN ?? 'http://localhost:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    port: PORT,
    strictPort: true,
    proxy: {
      '/v1': API_ORIGIN,
      '/api': API_ORIGIN,
      '/ws': { target: API_ORIGIN, ws: true, changeOrigin: true },
    },
  },
  preview: { port: PORT, strictPort: true },
})
