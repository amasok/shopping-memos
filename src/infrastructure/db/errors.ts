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

/** ログに残してよい DB エラーの種類（値や detail は含めない） */
export interface DbErrorKind {
  /** PostgreSQL のエラーコード（23505 など）。DB のエラーでなければ undefined */
  code?: string
  constraint?: string
  table?: string
}

/**
 * DB のエラーの種類を取り出す（drizzle が包んだ cause もたどる）。
 * detail や params には値（ユーザー ID など）が入るので、ログには使わない
 */
export function describeDbError(error: unknown): DbErrorKind {
  let current: unknown = error
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const e = current as PgLikeError & { table_name?: unknown }
    if (typeof e.code === "string") {
      return {
        code: e.code,
        constraint: typeof e.constraint_name === "string" ? e.constraint_name : undefined,
        table: typeof e.table_name === "string" ? e.table_name : undefined,
      }
    }
    current = e.cause
  }
  return {}
}

/** ログ用の 1 行の表記（例: "code=23505 constraint=tags_pkey table=tags"） */
export function formatDbErrorKind(kind: DbErrorKind): string {
  if (!kind.code) return "code=unknown"
  return [`code=${kind.code}`, kind.constraint && `constraint=${kind.constraint}`, kind.table && `table=${kind.table}`]
    .filter(Boolean)
    .join(" ")
}
