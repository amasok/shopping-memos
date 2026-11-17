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
      // 目標は 80%（#155 で 4 項目とも達成）。現状値（2026-11 時点: lines 86.8 / statements 86.6 /
      // functions 82.2 / branches 81.2）の少し下に置く。下げない（#83）
      thresholds: {
        branches: 80,
        functions: 81,
        lines: 85,
        statements: 85,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
