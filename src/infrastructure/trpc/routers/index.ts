import { router } from "../server"
import { identityRouter } from "./identity"
import { catalogRouter } from "./catalog"
import { shoppingRouter } from "./shopping"
import { syncRouter } from "./sync"

/**
 * アプリケーションルーター
 * 全コンテキストのルーターを統合
 */
export const appRouter = router({
  identity: identityRouter,
  catalog: catalogRouter,
  shopping: shoppingRouter,
  sync: syncRouter,
})

/**
 * アプリケーションルーターの型
 * クライアント側で型推論に使用
 */
export type AppRouter = typeof appRouter
