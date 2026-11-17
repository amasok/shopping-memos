import { initTRPC, TRPCError } from "@trpc/server"
import { formatErrorShape, toClientError } from "./error-format"
import superjson from "superjson"
import { getAuth } from "@/infrastructure/auth/server"

/**
 * tRPCコンテキスト
 * 各リクエストで利用可能な情報を定義
 */
export interface Context {
  userId?: string
  user?: {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
  }
}

/**
 * コンテキスト作成関数（API Route から呼び出される）
 *
 * Better Auth の DB のセッション（Cookie）から作る（#61 A3a 3.3。design の D5）。
 * リクエストのたびに DB のセッションを確かめるので、ログアウトや失効はすぐ効く。
 * Auth.js の Cookie は読まない（切り替えの前のセッションはログインしていない扱い）
 */
export async function createContext(opts?: { req?: Request }): Promise<Context> {
  if (!opts?.req) return {}
  const session = await (await getAuth()).api.getSession({ headers: opts.req.headers })
  if (!session) return {}
  return {
    userId: session.user.id,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
    },
  }
}

/**
 * tRPC初期化
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  // 本番では予期しないエラーのメッセージと stack を返さない（#135）
  errorFormatter({ shape, error }) {
    return formatErrorShape(shape, error, { isProduction: process.env.NODE_ENV === "production" })
  },
})

/**
 * ルーター作成
 */
export const router = t.router

/**
 * パブリックプロシージャ
 * 認証不要のエンドポイント用
 */
export const publicProcedure = t.procedure

/**
 * 認証必須プロシージャ
 * ログイン済みユーザーのみアクセス可能
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "ログインが必要です",
    })
  }

  const result = await next({
    ctx: {
      ...ctx,
      userId: ctx.userId, // 型を確定させる
    },
  })
  // リポジトリのエラー（対象なし・ID の重複）を NOT_FOUND / CONFLICT にする（#62 O3b）
  if (!result.ok) {
    const clientError = toClientError(result.error)
    if (clientError) throw clientError
  }
  return result
})

/**
 * ミドルウェア作成
 */
export const middleware = t.middleware
