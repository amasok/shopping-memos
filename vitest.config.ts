import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "e2e"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      exclude: [
        "node_modules",
        "src/test",
        "**/*.d.ts",
        "**/*.config.{ts,js}",
        "**/types/**",
      ],
      // 目標は 80%。現状値（2026-11 時点: lines 72.4 / statements 72.8 / functions 63.9 / branches 66.2）の
      // 少し下に置き、段階的に 80 まで上げる。下げない（#83）
      thresholds: {
        branches: 66,
        functions: 63,
        lines: 72,
        statements: 72,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
