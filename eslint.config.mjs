import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// zod は src/shared/schemas/z.ts（JIT を止めたラッパー）経由で使う。
// 直接 import すると、クライアントで CSP の script-src eval 違反になる（#71）
const zodPaths = [
  {
    name: "zod",
    message: 'zod は "@/shared/schemas/z" から import してください（CSP の eval 違反を防ぐ。#71）',
  },
];
const sharedPatterns = [
  {
    group: ["zod/*"],
    message: 'zod は "@/shared/schemas/z" から import してください（CSP の eval 違反を防ぐ。#71）',
  },
  // 所有スコープの型と判定の import の経路は 1 つにする（#101・#151・#179）。
  // 古い経路（catalog の ownership、sync の entityAccess、shopping の catalogItemScope）は再エクスポートをやめた
  {
    group: [
      "**/services/ownership",
      "**/infrastructure/entityAccess",
      "**/services/catalogItemScope",
      // 同じフォルダからの相対 import（./ownership など）
      "./ownership",
      "./entityAccess",
      "./catalogItemScope",
    ],
    importNames: ["isSameScope", "canAccessScope", "scopeCondition", "DbExecutor", "OwnerScope"],
    message:
      '所有スコープの型と純粋な判定（OwnerScope・isSameScope）は "@/shared/domain/ownerScope"、DB を使う判定は "@/infrastructure/db/ownership" から import してください（#101・#151・#179）',
  },
  // 純粋な判定は共有カーネルに移した。ownership.ts は再エクスポートしない（#179）
  {
    group: ["@/infrastructure/db/ownership", "**/db/ownership", "../ownership"],
    importNames: ["isSameScope", "OwnerScope"],
    message: 'OwnerScope・isSameScope は "@/shared/domain/ownerScope" から import してください（#179）',
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-imports": ["error", { paths: zodPaths, patterns: sharedPatterns }],
    },
  },
  // domain は純粋に保つ: Drizzle・Dexie・tRPC・infrastructure を import しない（#179。design-doc 8 の方針 2）。
  // 既存の違反（domain/repositories の DbExecutor。design-doc 7.4）は (4) で直すまで対象から外す。
  // flat config では後のブロックの同じルールが前のものを置き換えるので、共通の制限もここで繰り返す
  {
    files: ["src/modules/*/domain/**/*.{ts,tsx}"],
    ignores: ["src/modules/*/domain/repositories/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: zodPaths,
          patterns: [
            ...sharedPatterns,
            {
              group: ["drizzle-orm", "drizzle-orm/*", "dexie", "dexie-react-hooks", "@trpc/*", "@/infrastructure/*", "**/infrastructure/**"],
              message:
                "domain から Drizzle・Dexie・tRPC・infrastructure を import しないでください。業務規則は純粋関数にし、I/O は application / infrastructure に置きます（#179）",
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
