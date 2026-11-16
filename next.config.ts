import type { NextConfig } from "next"
import { withSerwist } from "@serwist/turbopack"

const noStore = [{ key: "Cache-Control", value: "private, no-store" }]

const nextConfig: NextConfig = {
  env: {
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
