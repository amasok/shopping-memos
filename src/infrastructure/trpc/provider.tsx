"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { httpBatchLink, httpLink, splitLink } from "@trpc/client"
import { REQUEST_LIMITS } from "@/shared/schemas/limits"
import { MERGE_PATH } from "./request-limits"
import superjson from "superjson"
import { trpc } from "./client"

function getBaseUrl() {
  if (typeof window !== "undefined") {
    // ブラウザでは相対パス
    return ""
  }
  // サーバーサイドでは環境変数または localhost
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return `http://localhost:${process.env.PORT ?? 3000}`
}

/**
 * tRPC + React Query プロバイダー
 * layout.tsx でラップして使用
 *
 * @example
 * <TRPCProvider>
 *   {children}
 * </TRPCProvider>
 */
export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // オフラインファーストのため、staleTimeを長めに設定
            staleTime: 1000 * 60 * 5, // 5分
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        // sync.merge はボディが大きいので、バッチに混ぜず単独で送る（サーバーは単独のときだけ大きい上限を使う。#72）
        splitLink({
          condition: (op) => op.path === MERGE_PATH,
          true: httpLink({
            url: `${getBaseUrl()}/api/trpc`,
            transformer: superjson,
          }),
          false: httpBatchLink({
            url: `${getBaseUrl()}/api/trpc`,
            // サーバーのバッチ件数の上限（#72）に合わせて分割する
            maxItems: REQUEST_LIMITS.clientBatchSize,
            maxURLLength: REQUEST_LIMITS.clientMaxUrlLength,
            transformer: superjson,
          }),
        }),
      ],
    })
  )

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  )
}
