import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// M3: Vite + React SPA。E2E / px 検証がポートを固定できるよう dev / preview 双方で
// strictPort を有効にする(衝突時は黙って別ポートに逃がさない)。
const PORT = 5199

export default defineConfig({
  plugins: [react()],
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
})
