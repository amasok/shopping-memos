"use client"

import { createTRPCReact } from "@trpc/react-query"
import { type AppRouter } from "./routers"

/**
 * tRPC Reactクライアント
 * コンポーネントで使用
 *
 * @example
 * const { data } = trpc.catalog.getItems.useQuery({ groupId: "xxx" })
 */
export const trpc = createTRPCReact<AppRouter>()
