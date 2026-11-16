/** PostgreSQL の一意制約違反のエラーコード */
const UNIQUE_VIOLATION = "23505"

type PgLikeError = {
  code?: unknown
  constraint_name?: unknown
  constraint?: unknown
  detail?: unknown
  cause?: unknown
}

/**
 * 一意制約違反か（drizzle は DB のエラーを DrizzleQueryError で包み、元のエラーを cause に入れる）。
 * `hint` を渡すと、制約名か詳細にその文字列（列名など）を含むものだけを対象にする
 */
export function isUniqueViolation(error: unknown, hint?: string): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const e = current as PgLikeError
    if (e.code === UNIQUE_VIOLATION) {
      if (!hint) return true
      return [e.constraint_name, e.constraint, e.detail].some(
        (v) => typeof v === "string" && v.includes(hint)
      )
    }
    current = e.cause
  }
  return false
}
