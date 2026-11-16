import type { NextConfig } from "next"
import { withSerwist } from "@serwist/turbopack"
import { getPageExtensions } from "./src/lib/e2e/guard"
import { buildSecurityHeaders } from "./src/lib/security/headers"

const noStore = [{ key: "Cache-Control", value: "private, no-store" }]

const nextConfig: NextConfig = {
  // E2E 専用ルート（route.e2e.ts）は E2E_BUILD=true のビルドにだけ含める（#70）
  pageExtensions: getPageExtensions(),
  env: {
    // E2E 用ログインの有無をビルド時に固定する。E2E_BUILD=true 以外のビルドでは常に無効（#70）
    E2E_BUILD: process.env.E2E_BUILD === "true" ? "true" : "false",
    // 強制更新（MIN_CLIENT_RELEASE）のリリース番号。新しいデプロイほど必ず大きい
    NEXT_PUBLIC_BUILD_TIME: String(Date.now()),
    NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
    ],
  },
  async headers() {
    return [
      // セキュリティヘッダ（#71）。全ルートに付ける
      {
        source: "/:path*",
        headers: buildSecurityHeaders({ isDev: process.env.NODE_ENV === "development" }),
      },
      {
        source: "/serwist/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      { source: "/api/trpc/:path*", headers: noStore },
      { source: "/api/auth/:path*", headers: noStore },
    ]
  },
}

export default withSerwist(nextConfig)
