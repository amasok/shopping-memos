import { createAuthRouteHandler } from "@/infrastructure/auth/route"
import { getAuth } from "@/infrastructure/auth/server"
import { resolveAuthEnv } from "@/infrastructure/auth/env"

/**
 * Better Auth の route（#61 A3a 3.2）。許可リストとオリジンの確認は createAuthRouteHandler
 */
const handler = createAuthRouteHandler({
  handle: async (request) => (await getAuth()).handler(request),
  trustedOrigins: () => resolveAuthEnv(process.env).trustedOrigins,
})

export { handler as GET, handler as POST }
