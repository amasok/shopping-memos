import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { SQL } from "drizzle-orm"

const state = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  deletes: [] as Array<{ table: string }>,
  count: 0,
  selectWhere: [] as Array<{ sql: string; params: unknown[] }>,
}))

vi.mock("@/infrastructure/db/drizzle/client", async () => {
  const { getTableName: tn } = await import("drizzle-orm")
  const name = (t: unknown) => tn(t as Parameters<typeof tn>[0])
  const { PgDialect: Dialect } = await import("drizzle-orm/pg-core")
  const d = new Dialect()
  const row = (table: string, values: Record<string, unknown>) => ({ id: "g", ...values, _table: table })
  const db = {
      // グループ作成はトランザクション（#73-3）。この疑似 DB では、そのまま同じ db で実行する
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
      insert: (t: unknown) => ({
        values: (values: Record<string, unknown>) => {
          state.inserts.push({ table: name(t), values })
          const result = Promise.resolve(undefined) as Promise<undefined> & { returning: () => Promise<unknown[]> }
          result.returning = async () => [row(name(t), values)]
          return result
        },
      }),
      update: (t: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            state.updates.push({ table: name(t), values })
            return { returning: async () => [row(name(t), values)] }
          },
        }),
      }),
      delete: (t: unknown) => ({
        where: async () => {
          state.deletes.push({ table: name(t) })
        },
      }),
      select: () => ({
        from: () => ({
          where: async (w: SQL) => {
            const q = d.sqlToQuery(w)
            state.selectWhere.push({ sql: q.sql, params: q.params })
            return [{ count: state.count }]
          },
        }),
      }),
  }
  return { db }
})

import { DrizzleGroupRepository } from "../infrastructure/repositories/DrizzleGroupRepository"

const NOW = new Date("2026-03-01T00:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  state.inserts = []
  state.updates = []
  state.deletes = []
  state.selectWhere = []
  state.count = 0
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("DrizzleGroupRepository の招待コード (#67)", () => {
  it("グループ作成時に、8文字のコードと7日後の有効期限を設定する", async () => {
    await new DrizzleGroupRepository().createWithOwner({ id: "g1", name: "家族", ownerId: "u1" })

    const group = state.inserts.find((i) => i.table === "groups")!.values
    expect(group.inviteCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)
    expect((group.inviteCodeExpiresAt as Date).getTime()).toBe(NOW.getTime() + 7 * DAY)
  })

  it("再生成時に、新しい8文字のコードと、再生成から7日後の有効期限を設定する", async () => {
    await new DrizzleGroupRepository().regenerateInviteCode("g1")

    const set = state.updates.find((u) => u.table === "groups")!.values
    expect(set.inviteCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)
    expect((set.inviteCodeExpiresAt as Date).getTime()).toBe(NOW.getTime() + 7 * DAY)
  })

  it("時間が経ってから再生成すると、有効期限もその時点から7日後になる", async () => {
    const repo = new DrizzleGroupRepository()
    await repo.regenerateInviteCode("g1")
    vi.setSystemTime(new Date(NOW.getTime() + 3 * DAY))
    await repo.regenerateInviteCode("g1")

    const [first, second] = state.updates.map((u) => (u.values.inviteCodeExpiresAt as Date).getTime())
    expect(second - first).toBe(3 * DAY)
  })

  it("再生成のたびに異なるコードになる", async () => {
    const repo = new DrizzleGroupRepository()
    await repo.regenerateInviteCode("g1")
    await repo.regenerateInviteCode("g1")

    expect(state.updates[0].values.inviteCode).not.toBe(state.updates[1].values.inviteCode)
  })
})

describe("DrizzleGroupRepository.recordInviteCodeAttempt (#67)", () => {
  it("試行を記録してから、窓内の件数を返す", async () => {
    state.count = 4

    const count = await new DrizzleGroupRepository().recordInviteCodeAttempt("u1", 60 * 60 * 1000)

    expect(count).toBe(4)
    const attempt = state.inserts.find((i) => i.table === "invite_code_attempts")!.values
    expect(attempt).toMatchObject({ userId: "u1", attemptedAt: NOW })
  })

  it("件数の集計は、そのユーザーの直近の窓(1時間)に限る", async () => {
    await new DrizzleGroupRepository().recordInviteCodeAttempt("u1", 60 * 60 * 1000)

    const where = state.selectWhere[0]
    expect(where.sql).toContain('"user_id" = $1')
    expect(where.params[0]).toBe("u1")
    expect(new Date(where.params[1] as string).getTime()).toBe(NOW.getTime() - 60 * 60 * 1000)
  })

  it("古い試行履歴を削除する", async () => {
    await new DrizzleGroupRepository().recordInviteCodeAttempt("u1", 60 * 60 * 1000)

    expect(state.deletes.map((d) => d.table)).toEqual(["invite_code_attempts"])
  })

  it("件数が取れなければ 0 を返す", async () => {
    state.count = undefined as unknown as number

    const count = await new DrizzleGroupRepository().recordInviteCodeAttempt("u1", 1000)

    expect(count).toBe(0)
  })
})
