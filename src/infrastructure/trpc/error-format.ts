import { TRPCError } from "@trpc/server"
import { DuplicateIdError, RowNotFoundError } from "@/infrastructure/db/errors"

/**
 * 本番で、予期しないエラー（INTERNAL_SERVER_ERROR）のメッセージに代えて返す文言（#135）
 */
export const INTERNAL_ERROR_MESSAGE = "サーバーでエラーが発生しました。時間をおいて、もう一度お試しください"

type Shape = { message: string; data: { stack?: string } }

/**
 * tRPC のエラー応答を整える（#135）
 *
 * 本番では:
 * - INTERNAL_SERVER_ERROR のメッセージを汎用の文言にする。DB のエラー（"Failed query: select ... params: <ユーザー ID>"）
 *   などがそのまま返ると、スキーマや内部の ID が漏れる。詳細はサーバーのログ（route の onError）にだけ残す
 * - stack を返さない
 *
 * 意図して投げた TRPCError（BAD_REQUEST・NOT_FOUND・FORBIDDEN など）のメッセージは、画面に出すためそのまま返す
 */
export function formatErrorShape<S extends Shape>(
  shape: S,
  error: Pick<TRPCError, "code">,
  { isProduction }: { isProduction: boolean }
): S {
  if (!isProduction) return shape
  // stack を除いた data（data 自体は code・httpStatus・path を含むので残す）
  const data = { ...shape.data }
  delete data.stack
  return {
    ...shape,
    message: error.code === "INTERNAL_SERVER_ERROR" ? INTERNAL_ERROR_MESSAGE : shape.message,
    data,
  }
}

/**
 * リポジトリが投げたエラー（#62 O3b）を、利用者に見せる tRPC のエラーに変える。対象外なら null
 * - RowNotFoundError（更新・削除の対象がない・削除済み・スコープ外）→ NOT_FOUND
 * - DuplicateIdError（クライアントで採番した ID が使用済み）→ CONFLICT
 */
export function toClientError(error: TRPCError): TRPCError | null {
  const cause = error.cause
  if (cause instanceof RowNotFoundError) {
    return new TRPCError({ code: "NOT_FOUND", message: cause.message, cause })
  }
  if (cause instanceof DuplicateIdError) {
    return new TRPCError({ code: "CONFLICT", message: cause.message, cause })
  }
  return null
}
