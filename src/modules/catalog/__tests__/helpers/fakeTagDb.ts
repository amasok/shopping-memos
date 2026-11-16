import { PgDialect } from "drizzle-orm/pg-core"
import { getTableName, type SQL } from "drizzle-orm"

const dialect = new PgDialect()

export interface TagRow {
  id: string
  userId: string | null
  groupId: string | null
}

export interface Recorded {
  table: string
  values: unknown
}

/**
 * tags の SELECT（inArray(tags.id, ids)）に tagMap から行を返し、
 * INSERT を記録するモック DB。transaction は自身をそのまま渡す。
 */
export function createFakeTagDb(tagMap: Record<string, TagRow> = {}) {
  const inserts: Recorded[] = []
  const selects: string[] = []

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: (where: SQL) => {
          const name = getTableName(table as Parameters<typeof getTableName>[0])
          selects.push(name)
          const run = async () => {
            if (name !== "tags") return []
            const { params } = dialect.sqlToQuery(where)
            return params.map((p) => tagMap[String(p)]).filter(Boolean)
          }
          // await してもよいし、.limit(n) を付けてもよい（タグの名前での検索は limit を付ける）
          const result = run() as Promise<unknown[]> & { limit: (n: number) => Promise<unknown[]> }
          result.limit = async (n: number) => (await run()).slice(0, n)
          return result
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        inserts.push({
          table: getTableName(table as Parameters<typeof getTableName>[0]),
          values,
        })
      },
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb(db),
  }

  return { db, inserts, selects }
}
