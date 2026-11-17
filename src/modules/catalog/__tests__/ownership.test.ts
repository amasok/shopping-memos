import { describe, it, expect } from "vitest"
import { areTagsInScope } from "../application/services/ownership"
import type { DbExecutor } from "@/infrastructure/db/ownership"
import { isSameScope } from "@/shared/domain/ownerScope"

/** select().from().where() の結果として rows を返すモック executor */
function createExecutor(rows: unknown[]): DbExecutor {
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.where = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => resolve(rows)
  return { select: () => chain } as unknown as DbExecutor
}

describe("isSameScope", () => {
  it("同じグループのデータは作成者が違っても同じスコープ", () => {
    expect(isSameScope({ userId: "u1", groupId: "g1" }, { userId: "u2", groupId: "g1" })).toBe(true)
  })

  it("別グループのデータは別スコープ", () => {
    expect(isSameScope({ userId: "u1", groupId: "g1" }, { userId: "u1", groupId: "g2" })).toBe(false)
  })

  it("グループデータと個人データは別スコープ", () => {
    expect(isSameScope({ userId: "u1", groupId: "g1" }, { userId: "u1", groupId: null })).toBe(false)
    expect(isSameScope({ userId: "u1", groupId: undefined }, { userId: "u1", groupId: "g1" })).toBe(false)
  })

  it("個人データは作成者が一致する場合のみ同じスコープ", () => {
    expect(isSameScope({ userId: "u1", groupId: null }, { userId: "u1", groupId: undefined })).toBe(true)
    expect(isSameScope({ userId: "u1", groupId: null }, { userId: "u2", groupId: null })).toBe(false)
  })

  it("所有者のいない個人データはどのスコープとも一致しない", () => {
    expect(isSameScope({ userId: null, groupId: null }, { userId: null, groupId: null })).toBe(false)
  })
})

describe("areTagsInScope", () => {
  const scope = { userId: "u1", groupId: null }

  it("タグ指定なしは許可", async () => {
    expect(await areTagsInScope(undefined, scope, { executor: createExecutor([]) })).toBe(true)
    expect(await areTagsInScope([], scope, { executor: createExecutor([]) })).toBe(true)
  })

  it("同じスコープのタグのみなら許可", async () => {
    const executor = createExecutor([{ id: "t1", userId: "u1", groupId: null }])
    expect(await areTagsInScope(["t1"], scope, { executor })).toBe(true)
  })

  it("他ユーザーのタグを含むと拒否", async () => {
    const executor = createExecutor([
      { id: "t1", userId: "u1", groupId: null },
      { id: "t2", userId: "u2", groupId: null },
    ])
    expect(await areTagsInScope(["t1", "t2"], scope, { executor })).toBe(false)
  })

  it("存在しないタグを含むと拒否", async () => {
    const executor = createExecutor([{ id: "t1", userId: "u1", groupId: null }])
    expect(await areTagsInScope(["t1", "missing"], scope, { executor })).toBe(false)
  })

  it("allowedTagIds に含まれるタグは DB を参照せず許可", async () => {
    const executor = { select: () => { throw new Error("should not query") } } as unknown as DbExecutor
    expect(
      await areTagsInScope(["new-tag"], scope, { executor, allowedTagIds: new Set(["new-tag"]) })
    ).toBe(true)
  })
})
