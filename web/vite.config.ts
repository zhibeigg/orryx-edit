import path from "path"
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // 构建到 server 的 resources/static 目录，打 jar 时自动包含
    outDir: path.resolve(__dirname, "../server/src/main/resources/static"),
    emptyOutDir: true,
  },
  test: {
    globals: true,
  },
})
