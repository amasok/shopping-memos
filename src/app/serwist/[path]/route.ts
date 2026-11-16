import { createSerwistRoute } from "@serwist/turbopack"
import { APP_SHELL_URLS } from "@/lib/sw/config"

const killSwitch = process.env.SW_KILL_SWITCH === "true"
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
