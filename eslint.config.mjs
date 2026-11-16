import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // zod は src/shared/schemas/z.ts（JIT を止めたラッパー）経由で使う。
  // 直接 import すると、クライアントで CSP の script-src eval 違反になる（#71）
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "zod",
              message: 'zod は "@/shared/schemas/z" から import してください（CSP の eval 違反を防ぐ。#71）',
            },
          ],
          patterns: [
            {
              group: ["zod/*"],
              message: 'zod は "@/shared/schemas/z" から import してください（CSP の eval 違反を防ぐ。#71）',
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Coverage reports:
    "coverage/**",
  ]),
]);

export default eslintConfig;
