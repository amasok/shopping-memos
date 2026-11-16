import { createSerwistRoute } from "@serwist/turbopack"
import { APP_SHELL_URLS } from "@/lib/sw/config"

// 段階 2（SW_KILL_SWITCH=true）に加え、段階 1（NEXT_PUBLIC_SW_ENABLED=false）のビルドでも自己消去用の SW を配信する。
// 通常の SW は waiting で待つため、プリキャッシュ済みの古い HTML が返り続け、段階 1 の解除コードが届かないことがある
const killSwitch =
  process.env.SW_KILL_SWITCH === "true" ||
  process.env.NEXT_PUBLIC_SW_ENABLED === "false"
const revision =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_BUILD_ID ?? crypto.randomUUID()

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    // 段階 2: SW_KILL_SWITCH=true のビルドでは、自己消去用の SW を配信する
    swSrc: killSwitch ? "src/app/sw-kill.ts" : "src/app/sw.ts",
    additionalPrecacheEntries: killSwitch
      ? []
      : APP_SHELL_URLS.map((url) => ({ url, revision })),
    useNativeEsbuild: true,
  })
