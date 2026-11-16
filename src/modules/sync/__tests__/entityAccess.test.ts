import { describe, it, expect } from "vitest"
import {
  canAccessScope,
  checkEntityAccess,
  type DbExecutor,
} from "../infrastructure/entityAccess"

/**
 * select().from().innerJoin().where().limit() のチェーンを受け付け、
 * 呼び出し順に results の値を返すモック executor
 */
function createExecutor(results: unknown[][]): DbExecutor {
  let call = 0
  const makeChain = () => {
    const rows = results[call++] ?? []
    const chain: Record<string, unknown> = {}
    for (const m of ["from", "innerJoin", "where", "limit"]) {
      chain[m] = () => chain
    }
    chain.then = (resolve: (v: unknown) => unknown) => resolve(rows)
    return chain
  }
  return { select: () => makeChain() } as unknown as DbExecutor
}

describe("canAccessScope", () => {
  it("個人データは作成者本人のみアクセスできる", async () => {
    const executor = createExecutor([])
    expect(await canAccessScope(executor, { userId: "u1", groupId: null }, "u1")).toBe(true)
    expect(await canAccessScope(executor, { userId: "u1", groupId: null }, "u2")).toBe(false)
  })

  it("所有者のいない個人データには誰もアクセスできない", async () => {
    const executor = createExecutor([])
    expect(await canAccessScope(executor, { userId: null, groupId: null }, "u1")).toBe(false)
  })

  it("グループデータはメンバーならアクセスできる", async () => {
    const executor = createExecutor([[{ id: "m1" }]])
    expect(await canAccessScope(executor, { userId: "u1", groupId: "g1" }, "u2")).toBe(true)
  })

  it("グループデータは非メンバーならアクセスできない（作成者でも）", async () => {
    const executor = createExecutor([[]])
    expect(await canAccessScope(executor, { userId: "u1", groupId: "g1" }, "u1")).toBe(false)
  })
})

describe("checkEntityAccess", () => {
  it("存在しないエンティティは not_found", async () => {
    const executor = createExecutor([[]])
    expect(await checkEntityAccess(executor, "item", "x", "u1")).toBe("not_found")
  })

  it("自分の個人アイテムは allowed", async () => {
    const executor = createExecutor([[{ userId: "u1", groupId: null }]])
    expect(await checkEntityAccess(executor, "item", "i1", "u1")).toBe("allowed")
  })

  it("他人の個人アイテムは denied", async () => {
    const executor = createExecutor([[{ userId: "u2", groupId: null }]])
    expect(await checkEntityAccess(executor, "tag", "t1", "u1")).toBe("denied")
  })

  it("非メンバーのグループのリストアイテムは denied", async () => {
    const executor = createExecutor([[{ userId: "u2", groupId: "g1" }], []])
    expect(await checkEntityAccess(executor, "listItem", "li1", "u1")).toBe("denied")
  })

  it("所属グループの履歴は allowed", async () => {
    const executor = createExecutor([[{ userId: "u2", groupId: "g1" }], [{ id: "m1" }]])
    expect(await checkEntityAccess(executor, "history", "l1", "u1")).toBe("allowed")
  })
})
