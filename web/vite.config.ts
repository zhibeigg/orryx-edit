import path from "path"
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 将受版本控制的 schema 作为 /actions-schema.json 复制到静态资源目录。
  publicDir: path.resolve(__dirname, "../schemas"),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // 构建到 server 的 resources/static 目录，打 jar 时自动包含
    outDir: path.resolve(__dirname, "../server/src/main/resources/static"),
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vendor-monaco", test: /node_modules[\\/]monaco-editor[\\/]/, priority: 70, includeDependenciesRecursively: false },
            { name: "vendor-three", test: /node_modules[\\/]three[\\/]/, priority: 60, includeDependenciesRecursively: false },
            { name: "vendor-flow", test: /node_modules[\\/](?:@xyflow|@dagrejs)[\\/]/, priority: 50, includeDependenciesRecursively: false },
            { name: "vendor-radix", test: /node_modules[\\/](?:@radix-ui|cmdk)[\\/]/, priority: 40, includeDependenciesRecursively: false },
            { name: "vendor-yaml", test: /node_modules[\\/]yaml[\\/]/, priority: 30, includeDependenciesRecursively: false },
            { name: "vendor-state", test: /node_modules[\\/](?:zustand|use-sync-external-store)[\\/]/, priority: 20, includeDependenciesRecursively: false },
            { name: "vendor-react", test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/, priority: 10, includeDependenciesRecursively: false },
          ],
        },
      },
    },
  },
  test: {
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/lib/parameter-wizard.ts", "src/types/schema.ts"],
      thresholds: {
        lines: 60,
        functions: 55,
        statements: 60,
        branches: 40,
      },
    },
  },
})
