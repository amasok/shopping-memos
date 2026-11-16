import { PgDialect } from "drizzle-orm/pg-core"
import { getTableName, type SQL } from "drizzle-orm"

const dialect = new PgDialect()

export interface RecordedQuery {
  kind: "select" | "update" | "delete"
  table: string
  set?: Record<string, unknown>
  sql: string
  params: unknown[]
}

export interface FakeDbOptions {
  /** shopping_lists の SELECT が返すスコープ行（undefined なら該当リストなし） */
  listScope?: { userId: string | null; groupId: string | null }
  /** items の UPDATE/DELETE の where パラメータに含まれる名前 → 返す ID（returning） */
  itemIdsByName?: Record<string, string[]>
}

/**
 * drizzle のクエリビルダーを模した記録用 DB
 * 実行された where 句を SQL 文字列とパラメータに変換して記録する
 */
export function createFakeDb(options: FakeDbOptions = {}) {
  const queries: RecordedQuery[] = []

  const run = (
    kind: RecordedQuery["kind"],
    table: unknown,
    set: Record<string, unknown> | undefined,
    where: SQL
  ) => {
    const q = dialect.sqlToQuery(where)
    const tableName = getTableName(table as Parameters<typeof getTableName>[0])
    queries.push({ kind, table: tableName, set, sql: q.sql, params: q.params })
    if (tableName === "shopping_lists" && kind === "select") {
      return options.listScope ? [options.listScope] : []
    }
    if (tableName === "items") {
      return q.params.flatMap((p) => options.itemIdsByName?.[String(p)] ?? []).map((id) => ({ id }))
    }
    return []
  }

  const mutation = (kind: "update" | "delete", table: unknown, set?: Record<string, unknown>) => ({
    set: (values: Record<string, unknown>) => mutation(kind, table, values),
    where: (where: SQL) => {
      const rows = run(kind, table, set, where)
      return {
        returning: async () => rows,
        then: (resolve: (v: unknown) => unknown) => resolve(undefined),
      }
    },
  })

  const executor = {
    select: () => ({
      from: (table: unknown) => ({
        where: async (where: SQL) => run("select", table, undefined, where),
      }),
    }),
    update: (table: unknown) => mutation("update", table),
    delete: (table: unknown) => mutation("delete", table),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb(executor),
  }

  return { db: executor, queries }
}
