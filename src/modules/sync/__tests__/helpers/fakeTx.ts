import { PgDialect } from "drizzle-orm/pg-core"
import { getTableName, type SQL } from "drizzle-orm"

const dialect = new PgDialect()

export interface FakeTxOptions {
  /** shopping_lists の SELECT: where パラメータ(リストID) → スコープ行 */
  lists?: Record<string, { userId: string | null; groupId: string | null }>
  /** group_members の SELECT: "groupId:userId" のメンバーシップ */
  members?: string[]
  /** shopping_lists の UPDATE ... RETURNING が返す行数（0 なら更新対象なし） */
  updateReturnsRows?: number
}

export interface Recorded {
  kind: "insert" | "update"
  table: string
  values?: unknown
  sql?: string
  params?: unknown[]
}

/** DataMergeService が使う db.transaction のモック。実行された INSERT/UPDATE を記録する */
export function createFakeTx(options: FakeTxOptions = {}) {
  const writes: Recorded[] = []

  const tx = {
    select: () => ({
      from: (table: unknown) => {
        const name = getTableName(table as Parameters<typeof getTableName>[0])
        const chain = {
          where: (where: SQL) => {
            const { params } = dialect.sqlToQuery(where)
            let rows: unknown[] = []
            if (name === "shopping_lists") {
              const scope = options.lists?.[String(params[0])]
              rows = scope ? [scope] : []
            } else if (name === "group_members") {
              const hit = options.members?.includes(`${params[0]}:${params[1]}`)
              rows = hit ? [{ id: "m" }] : []
            }
            const result = Promise.resolve(rows) as Promise<unknown[]> & { limit: () => Promise<unknown[]> }
            result.limit = () => Promise.resolve(rows)
            return result
          },
        }
        return chain
      },
    }),
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        writes.push({
          kind: "insert",
          table: getTableName(table as Parameters<typeof getTableName>[0]),
          values,
        })
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: (where: SQL) => {
          const q = dialect.sqlToQuery(where)
          writes.push({
            kind: "update",
            table: getTableName(table as Parameters<typeof getTableName>[0]),
            values,
            sql: q.sql,
            params: q.params,
          })
          const n = options.updateReturnsRows ?? 1
          return { returning: async () => Array.from({ length: n }, () => ({ id: "x" })) }
        },
      }),
    }),
  }

  // SAVEPOINT（tx.transaction）はそのまま実行するだけのモック
  const txWithSavepoint = Object.assign(tx, {
    transaction: async <T>(cb: (t: typeof tx) => Promise<T>) => cb(tx),
  })
  const db = { transaction: async <T>(cb: (t: typeof txWithSavepoint) => Promise<T>) => cb(txWithSavepoint) }
  return { db, writes }
}
