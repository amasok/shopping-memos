import { describe, it, expect, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"

const state = vi.hoisted(() => ({
  where: null as unknown,
  orderBy: null as unknown,
  limit: null as unknown,
  rows: [] as unknown[],
}))

vi.mock("@/infrastructure/db/drizzle/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          state.where = w
          return {
            orderBy: (o: unknown) => {
              state.orderBy = o
              return {
                limit: async (n: unknown) => {
                  state.limit = n
                  return state.rows
                },
              }
            },
          }
        },
      }),
    }),
  },
}))

import { DrizzleSyncRepository } from "../infrastructure/repositories/DrizzleSyncRepository"

const dialect = new PgDialect()
const whereQuery = () => dialect.sqlToQuery(state.where as SQL)
const orderQuery = () => dialect.sqlToQuery(state.orderBy as SQL)

describe("DrizzleSyncRepository.findLatestEntityState (#69)", () => {
  it("作成日時の降順で1件取得する（最新の操作ログを競合判定に使う）", async () => {
    await new DrizzleSyncRepository().findLatestEntityState("item", "e1")

    expect(orderQuery().sql).toMatch(/"created_at" desc/)
    expect(state.limit).toBe(1)
  })

  it("userId 指定なしでは、エンティティで絞るだけでユーザーでは絞らない", async () => {
    await new DrizzleSyncRepository().findLatestEntityState("item", "e1")

    expect(whereQuery().sql).not.toContain("user_id")
    expect(whereQuery().params).toEqual(["item", "e1"])
  })

  it("userId 指定時は、そのユーザーの操作ログだけに絞る", async () => {
    await new DrizzleSyncRepository().findLatestEntityState("item", "e1", { userId: "user-me" })

    expect(whereQuery().sql).toContain('"sync_operations"."user_id" = $3')
    expect(whereQuery().params).toEqual(["item", "e1", "user-me"])
  })

  it("操作ログがなければ null を返す", async () => {
    state.rows = []

    expect(await new DrizzleSyncRepository().findLatestEntityState("item", "e1")).toBeNull()
  })
})
