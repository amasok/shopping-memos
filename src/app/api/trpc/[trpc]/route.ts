import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { appRouter } from "@/infrastructure/trpc/routers"
import { createContext } from "@/infrastructure/trpc/server"

/**
 * tRPC API ハンドラー
 * Next.js App Router用
 */
const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
    onError:
      process.env.NODE_ENV === "development"
        ? ({ path, error }) => {
            console.error(`❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`)
          }
        : undefined,
  })

export { handler as GET, handler as POST }
