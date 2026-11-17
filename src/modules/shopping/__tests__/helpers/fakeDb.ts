import { PgDialect } from "drizzle-orm/pg-core"
import { getTableName, type SQL } from "drizzle-orm"

const dialect = new PgDialect()

export interface RecordedQuery {
  kind: "select" | "update" | "delete"
  table: string
  set?: Record<string, unknown>
  sql: string
  params: unknown[]
  /** SELECT ... FOR UPDATE（行のロック）だったか */
  forUpdate?: boolean
  /** トランザクション（db.transaction のコールバックの tx）の中で実行されたか */
  inTransaction: boolean
}

export interface FakeDbOptions {
  /** shopping_lists の SELECT が返すスコープ行（getListScope。undefined なら該当リストなし） */
  listScope?: { userId: string | null; groupId: string | null }
  /** shopping_lists の SELECT ... FOR UPDATE が返す行（lockAccessibleList。null・undefined なら使えないリスト） */
  lockedList?: Record<string, unknown> | null
  /** list_items の SELECT が返す行（readListEntries） */
  entries?: Array<{ id: string; name: string; checked: boolean }>
  /**
   * items の SELECT が返す候補（findScopedCandidatesByNames）。
   * 渡すと、items の UPDATE は WHERE のパラメータに ID が含まれる候補を returning で返す
   */
  catalogItems?: Array<Record<string, unknown> & { id: string }>
  /** items の UPDATE/DELETE の where パラメータに含まれる名前 → 返す ID（returning。deleteScopedItemsByName） */
  itemIdsByName?: Record<string, string[]>
  /** shopping_lists の UPDATE の returning が返す行（既定は 1 行） */
  listUpdateRows?: Array<Record<string, unknown>>
  /** shopping_lists の UPDATE で投げる（トランザクションの途中の失敗） */
  failListUpdate?: Error
}

/**
 * drizzle のクエリビルダーを模した記録用 DB
 * 実行された where 句を SQL 文字列とパラメータに変換して記録する
 */
export function createFakeDb(options: FakeDbOptions = {}) {
  const queries: RecordedQuery[] = []

  const makeExecutor = (inTransaction: boolean) => {
    const run = (
      kind: RecordedQuery["kind"],
      table: unknown,
      set: Record<string, unknown> | undefined,
      where: SQL,
      forUpdate = false
    ): unknown[] => {
      const q = dialect.sqlToQuery(where)
      const tableName = getTableName(table as Parameters<typeof getTableName>[0])
      queries.push({ kind, table: tableName, set, sql: q.sql, params: q.params, forUpdate, inTransaction })
      if (tableName === "shopping_lists" && kind === "select") {
        if (forUpdate) return options.lockedList ? [options.lockedList] : []
        return options.listScope ? [options.listScope] : []
      }
      if (tableName === "shopping_lists" && kind === "update") {
        if (options.failListUpdate) throw options.failListUpdate
        return options.listUpdateRows ?? [{ id: "updated-list", status: "in_progress" }]
      }
      if (tableName === "list_items" && kind === "select") {
        return options.entries ?? []
      }
      if (tableName === "items") {
        if (options.catalogItems) {
          if (kind === "select") return options.catalogItems
          return options.catalogItems.filter((c) => q.params.includes(c.id)).map((c) => ({ id: c.id }))
        }
        return q.params.flatMap((p) => options.itemIdsByName?.[String(p)] ?? []).map((id) => ({ id }))
      }
      return []
    }

    const mutation = (kind: "update" | "delete", table: unknown, set?: Record<string, unknown>) => ({
      set: (values: Record<string, unknown>) => mutation(kind, table, values),
      where: (where: SQL) => {
        let rows: unknown[] = []
        let error: unknown
        try {
          rows = run(kind, table, set, where)
        } catch (e) {
          error = e
        }
        return {
          returning: async () => {
            if (error) throw error
            return rows
          },
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            error ? reject(error) : resolve(undefined),
        }
      },
    })

    const select = () => ({
      from: (table: unknown) => ({
        where: (where: SQL) => ({
          for: async () => run("select", table, undefined, where, true),
          then: (resolve: (v: unknown) => unknown) => resolve(run("select", table, undefined, where)),
        }),
      }),
    })

    return {
      select,
      update: (table: unknown) => mutation("update", table),
      delete: (table: unknown) => mutation("delete", table),
    }
  }

  const tx = makeExecutor(true)
  const executor = {
    ...makeExecutor(false),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb(tx),
  }

  return { db: executor, queries }
}
