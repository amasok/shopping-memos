import { describe, it, expect, vi } from "vitest"

vi.mock("@/infrastructure/db/drizzle/client", () => ({
  db: new Proxy({}, { get: () => () => { throw new Error("DBに到達してはいけない") } }),
}))

import { DrizzleItemRepository } from "../infrastructure/repositories/DrizzleItemRepository"
import { DrizzleTagRepository } from "../infrastructure/repositories/DrizzleTagRepository"

describe("findMany のスコープ必須化 (#68)", () => {
  it("アイテム: groupId も userId もない検索は、DBに問い合わせず例外にする", async () => {
    await expect(new DrizzleItemRepository().findMany({})).rejects.toThrow("groupId または userId")
    await expect(new DrizzleItemRepository().findMany({ searchText: "牛乳" })).rejects.toThrow("groupId または userId")
  })

  it("タグ: groupId も userId もない検索は、DBに問い合わせず例外にする", async () => {
    await expect(new DrizzleTagRepository().findMany({})).rejects.toThrow("groupId または userId")
  })
})
