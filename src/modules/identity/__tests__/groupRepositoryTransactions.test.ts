import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SQL } from "drizzle-orm"

/**
 * #73-2 / #73-3: グループ作成と招待リンクの承認をトランザクションにする
 *
 * 疑似 DB: transaction のコールバックに渡す tx での書き込みを記録し、例外が出たら捨てる（ロールバック）
 */
const state = vi.hoisted(() => ({
  committed: [] as Array<{ op: string; table: string; values?: Record<string, unknown> }>,
  /** n 回目の groups の INSERT で投げるエラー（1 始まり） */
  groupInsertErrors: new Map<number, unknown>(),
  memberInsertError: null as unknown,
  /** 招待リンクの UPDATE ... RETURNING の結果 */
  claimRows: [] as unknown[],
  updateWhere: [] as Array<{ sql: string; params: unknown[] }>,
  groupInserts: 0,
  transactions: 0,
}))

vi.mock("@/infrastructure/db/drizzle/client", async () => {
  const { getTableName: tn } = await import("drizzle-orm")
  const name = (t: unknown) => tn(t as Parameters<typeof tn>[0])
  const { PgDialect: Dialect } = await import("drizzle-orm/pg-core")
  const d = new Dialect()

  const makeTx = (pending: typeof state.committed) => ({
    insert: (t: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const table = name(t)
        const run = async () => {
          if (table === "groups") {
            state.groupInserts++
            const err = state.groupInsertErrors.get(state.groupInserts)
            if (err) throw err
          }
          if (table === "group_members" && state.memberInsertError) throw state.memberInsertError
          pending.push({ op: "insert", table, values })
          return [{ id: values.id, ...values }]
        }
        const p = run() as Promise<unknown[]> & { returning: () => Promise<unknown[]> }
        p.returning = () => p
        return p
      },
    }),
    update: (t: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (w: SQL) => {
          const q = d.sqlToQuery(w)
          state.updateWhere.push({ sql: q.sql, params: q.params })
          return {
            returning: async () => {
              if (state.claimRows.length > 0) pending.push({ op: "update", table: name(t), values })
              return state.claimRows
            },
          }
        },
      }),
    }),
  })

  return {
    db: {
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        state.transactions++
        const pending: typeof state.committed = []
        const result = await cb(makeTx(pending)) // 例外ならロールバック（pending を捨てる）
        state.committed.push(...pending)
        return result
      },
    },
  }
})

import { DrizzleGroupRepository } from "../infrastructure/repositories/DrizzleGroupRepository"

const uniqueViolation = (constraint: string) =>
  Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("duplicate key"), { code: "23505", constraint_name: constraint }),
  })

beforeEach(() => {
  state.committed = []
  state.groupInsertErrors = new Map()
  state.memberInsertError = null
  state.claimRows = []
  state.updateWhere = []
  state.groupInserts = 0
  state.transactions = 0
})

const repo = new DrizzleGroupRepository()
const createInput = { id: "g1", name: "家族", ownerId: "u1" }

describe("createWithOwner (#73-3)", () => {
  it("グループとオーナーを 1 つのトランザクションで作る", async () => {
    await repo.createWithOwner(createInput)

    expect(state.transactions).toBe(1)
    expect(state.committed.map((r) => r.table)).toEqual(["groups", "group_members"])
    expect(state.committed[1].values).toMatchObject({ groupId: "g1", userId: "u1", role: "owner" })
  })

  it("オーナーの追加に失敗したら、グループも残さない", async () => {
    state.memberInsertError = new Error("fk violation")

    await expect(repo.createWithOwner(createInput)).rejects.toThrow("fk violation")
    expect(state.committed).toEqual([])
  })

  it("招待コードが重複したら、コードを作り直して再試行する", async () => {
    state.groupInsertErrors.set(1, uniqueViolation("groups_invite_code_unique"))

    await repo.createWithOwner(createInput)

    expect(state.transactions).toBe(2)
    expect(state.committed.map((r) => r.table)).toEqual(["groups", "group_members"])
  })

  it("招待コードの重複が続いたら、3 回で諦めてエラーにする", async () => {
    for (const n of [1, 2, 3]) state.groupInsertErrors.set(n, uniqueViolation("groups_invite_code_unique"))

    await expect(repo.createWithOwner(createInput)).rejects.toThrow()
    expect(state.transactions).toBe(3)
    expect(state.committed).toEqual([])
  })

  it("招待コード以外の重複（グループ ID など）は再試行しない", async () => {
    state.groupInsertErrors.set(1, uniqueViolation("groups_pkey"))

    await expect(repo.createWithOwner(createInput)).rejects.toThrow()
    expect(state.transactions).toBe(1)
  })
})

describe("acceptInvite (#73-2)", () => {
  const input = { inviteId: "inv1", groupId: "g1", userId: "u2", memberId: "m1" }

  it("未使用・期限内の招待リンクを確保できたら、同じトランザクションでメンバーを追加する", async () => {
    state.claimRows = [{ id: "inv1" }]

    expect(await repo.acceptInvite(input)).toBe(true)
    expect(state.transactions).toBe(1)
    expect(state.committed.map((r) => `${r.op}:${r.table}`)).toEqual(["update:invite_links", "insert:group_members"])
    expect(state.committed[1].values).toMatchObject({ id: "m1", groupId: "g1", userId: "u2", role: "member" })
  })

  it("確保の条件に「未使用」と「期限内」を含める（確認と使用の間に別のユーザーが使っても 1 人だけ）", async () => {
    state.claimRows = [{ id: "inv1" }]
    await repo.acceptInvite(input)

    const where = state.updateWhere[0].sql
    expect(where).toContain('"used_at" is null')
    expect(where).toMatch(/"expires_at" > \$\d/)
    expect(state.updateWhere[0].params).toContain("inv1")
  })

  it("確保できなければ（使用済み・期限切れ）false を返し、メンバーを追加しない", async () => {
    state.claimRows = []

    expect(await repo.acceptInvite(input)).toBe(false)
    expect(state.committed).toEqual([])
  })

  it("メンバーの追加に失敗したら、招待リンクも未使用のまま戻る", async () => {
    state.claimRows = [{ id: "inv1" }]
    state.memberInsertError = uniqueViolation("group_members_group_user_idx")

    await expect(repo.acceptInvite(input)).rejects.toThrow()
    expect(state.committed).toEqual([])
  })
})
