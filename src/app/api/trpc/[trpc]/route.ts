import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { appRouter } from "@/infrastructure/trpc/routers"
import { createContext } from "@/infrastructure/trpc/server"
import { enforceRequestLimits } from "@/infrastructure/trpc/request-limits"
import { resolveAuthEnv } from "@/infrastructure/auth/env"
import { crossOriginResponse, isSameOriginRequest } from "@/lib/security/origin"

const ENDPOINT = "/api/trpc"

/**
 * tRPC API ハンドラー
 * Next.js App Router用
 */
const handler = async (req: Request) => {
  // 別のオリジンからの mutation（POST）を断る（#61 A3a 3.3。design の D6。#71 の残り）
  if (req.method === "POST" && !isSameOriginRequest(req, resolveAuthEnv(process.env).trustedOrigins)) {
    return crossOriginResponse()
  }

  // バッチ件数とボディの大きさの上限（#72）
  const checked = await enforceRequestLimits(req, ENDPOINT)
  if ("response" in checked) return checked.response

  return fetchRequestHandler({
    endpoint: ENDPOINT,
    req: checked.request,
    router: appRouter,
    createContext,
    // 予期しないエラーは、本番でもサーバーのログに残す（応答では汎用の文言にする。#135）。
    // 開発中は、意図して投げたエラーも含めて出す
    onError: ({ path, error }) => {
      if (error.code === "INTERNAL_SERVER_ERROR" || process.env.NODE_ENV === "development") {
        console.error(`❌ tRPC failed on ${path ?? "<no-path>"} (${error.code}): ${error.message}`, error.cause ?? "")
      }
    },
  })
}

export { handler as GET, handler as POST }
