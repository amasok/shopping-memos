import { describe, it, expect } from "vitest"
import { selectItemsToPurchase, selectItemsToUnpurchase, type CatalogCandidate } from "../catalogMatch"

const PURCHASED = new Date("2026-01-01T00:00:00.000Z")

const item = (over: Partial<CatalogCandidate> & Pick<CatalogCandidate, "id">): CatalogCandidate => ({
  name: "牛乳",
  userId: "u1",
  groupId: null,
  purchasedAt: null,
  deletedAt: null,
  ...over,
})

describe("selectItemsToPurchase（買い物の完了の照合）", () => {
  it("グループのリストは同じグループの商品とだけ一致する", () => {
    const candidates = [
      item({ id: "gA", groupId: "A" }),
      item({ id: "gB", groupId: "B" }),
      item({ id: "personal", groupId: null }),
    ]
    expect(selectItemsToPurchase(["牛乳"], candidates, { userId: "u1", groupId: "A" })).toEqual(["gA"])
  })

  it("個人のリストは作成者の個人の商品とだけ一致する", () => {
    const candidates = [
      item({ id: "mine" }),
      item({ id: "others", userId: "u2" }),
      item({ id: "group", groupId: "A" }),
    ]
    expect(selectItemsToPurchase(["牛乳"], candidates, { userId: "u1", groupId: null })).toEqual(["mine"])
  })

  it("所有者がわからない個人のリストはどの商品とも一致しない", () => {
    const candidates = [item({ id: "mine" }), item({ id: "nobody", userId: null })]
    expect(selectItemsToPurchase(["牛乳"], candidates, { userId: null, groupId: null })).toEqual([])
  })

  it("論理削除された商品は照合しない", () => {
    const candidates = [item({ id: "alive" }), item({ id: "deleted", deletedAt: PURCHASED })]
    expect(selectItemsToPurchase(["牛乳"], candidates, { userId: "u1", groupId: null })).toEqual(["alive"])
  })

  it("名前が一致する商品だけを選ぶ", () => {
    const candidates = [item({ id: "milk" }), item({ id: "egg", name: "卵" }), item({ id: "bread", name: "パン" })]
    expect(selectItemsToPurchase(["牛乳", "卵"], candidates, { userId: "u1", groupId: null })).toEqual(["milk", "egg"])
  })

  it("購入状態は見ない（同じ名前の購入済みの商品も選ぶ。今のサーバーの振る舞い）", () => {
    const candidates = [item({ id: "unpurchased" }), item({ id: "purchased", purchasedAt: PURCHASED })]
    expect(selectItemsToPurchase(["牛乳"], candidates, { userId: "u1", groupId: null })).toEqual([
      "unpurchased",
      "purchased",
    ])
  })

  it("名前が空なら何も選ばない", () => {
    expect(selectItemsToPurchase([], [item({ id: "milk" })], { userId: "u1", groupId: null })).toEqual([])
  })
})

describe("selectItemsToUnpurchase（履歴の取り消しの照合）", () => {
  it("同じ名前・同じスコープの購入済みの商品だけを選ぶ", () => {
    const candidates = [
      item({ id: "purchased", purchasedAt: PURCHASED }),
      item({ id: "unpurchased" }),
      item({ id: "otherScope", groupId: "A", purchasedAt: PURCHASED }),
      item({ id: "deleted", purchasedAt: PURCHASED, deletedAt: PURCHASED }),
      item({ id: "otherName", name: "卵", purchasedAt: PURCHASED }),
    ]
    expect(selectItemsToUnpurchase(["牛乳"], candidates, { userId: "u1", groupId: null })).toEqual(["purchased"])
  })

  it("購入日時は ISO 文字列でも扱える（Dexie の保存形式）", () => {
    const candidates = [item({ id: "purchased", purchasedAt: "2026-01-01T00:00:00.000Z" })]
    expect(selectItemsToUnpurchase(["牛乳"], candidates, { userId: "u1", groupId: null })).toEqual(["purchased"])
  })
})
