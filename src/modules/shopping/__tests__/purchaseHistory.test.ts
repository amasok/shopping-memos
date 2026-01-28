import { describe, it, expect, beforeEach } from "vitest"
import type { PurchaseHistory, GetPurchaseHistoryQuery } from "../domain/entities/PurchaseHistory"

describe("PurchaseHistory エンティティ", () => {
  describe("購入履歴の構造", () => {
    it("購入履歴を作成できる", () => {
      const history: PurchaseHistory = {
        id: "history-1",
        listId: "list-1",
        location: "スーパーマーケット",
        itemIds: ["item-1", "item-2", "item-3"],
        groupId: "group-1",
        purchasedAt: new Date("2026-01-28T10:00:00Z"),
      }

      expect(history.id).toBe("history-1")
      expect(history.listId).toBe("list-1")
      expect(history.location).toBe("スーパーマーケット")
      expect(history.itemIds).toHaveLength(3)
      expect(history.groupId).toBe("group-1")
    })

    it("場所なしの購入履歴を作成できる", () => {
      const history: PurchaseHistory = {
        id: "history-2",
        listId: "list-2",
        location: null,
        itemIds: ["item-1"],
        groupId: null,
        purchasedAt: new Date(),
      }

      expect(history.location).toBeNull()
      expect(history.groupId).toBeNull()
    })

    it("アイテムなしの購入履歴を作成できる", () => {
      const history: PurchaseHistory = {
        id: "history-3",
        listId: "list-3",
        location: "コンビニ",
        itemIds: null,
        groupId: null,
        purchasedAt: new Date(),
      }

      expect(history.itemIds).toBeNull()
    })
  })
})

describe("GetPurchaseHistoryQuery", () => {
  describe("クエリパラメータ", () => {
    it("グループIDでフィルタできる", () => {
      const query: GetPurchaseHistoryQuery = {
        groupId: "group-1",
      }

      expect(query.groupId).toBe("group-1")
    })

    it("ページネーションを指定できる", () => {
      const query: GetPurchaseHistoryQuery = {
        limit: 10,
        offset: 20,
      }

      expect(query.limit).toBe(10)
      expect(query.offset).toBe(20)
    })

    it("すべてのパラメータを組み合わせられる", () => {
      const query: GetPurchaseHistoryQuery = {
        groupId: "group-1",
        limit: 5,
        offset: 0,
      }

      expect(query.groupId).toBe("group-1")
      expect(query.limit).toBe(5)
      expect(query.offset).toBe(0)
    })

    it("パラメータなしでも有効", () => {
      const query: GetPurchaseHistoryQuery = {}

      expect(query.groupId).toBeUndefined()
      expect(query.limit).toBeUndefined()
      expect(query.offset).toBeUndefined()
    })
  })
})

describe("PurchaseHistoryRepository インターフェース", () => {
  interface MockPurchaseHistoryRepository {
    histories: Map<string, PurchaseHistory>
  }

  let mockRepo: MockPurchaseHistoryRepository

  beforeEach(() => {
    mockRepo = {
      histories: new Map(),
    }
  })

  function createHistory(input: {
    id: string
    listId: string
    location?: string
    itemIds: string[]
    groupId?: string
  }): PurchaseHistory {
    const history: PurchaseHistory = {
      id: input.id,
      listId: input.listId,
      location: input.location ?? null,
      itemIds: input.itemIds,
      groupId: input.groupId ?? null,
      purchasedAt: new Date(),
    }
    mockRepo.histories.set(input.id, history)
    return history
  }

  function findById(id: string): PurchaseHistory | null {
    return mockRepo.histories.get(id) ?? null
  }

  function findMany(query: GetPurchaseHistoryQuery): PurchaseHistory[] {
    let result = Array.from(mockRepo.histories.values())

    if (query.groupId) {
      result = result.filter((h) => h.groupId === query.groupId)
    }

    // 日付降順でソート
    result.sort((a, b) => b.purchasedAt.getTime() - a.purchasedAt.getTime())

    if (query.offset) {
      result = result.slice(query.offset)
    }
    if (query.limit) {
      result = result.slice(0, query.limit)
    }

    return result
  }

  function deleteHistory(id: string): void {
    mockRepo.histories.delete(id)
  }

  it("履歴を作成できる", () => {
    const history = createHistory({
      id: "history-1",
      listId: "list-1",
      location: "スーパー",
      itemIds: ["item-1", "item-2"],
      groupId: "group-1",
    })

    expect(history.id).toBe("history-1")
    expect(mockRepo.histories.size).toBe(1)
  })

  it("履歴をIDで取得できる", () => {
    createHistory({
      id: "history-1",
      listId: "list-1",
      itemIds: ["item-1"],
    })

    const found = findById("history-1")
    expect(found).not.toBeNull()
    expect(found?.id).toBe("history-1")
  })

  it("存在しない履歴はnullを返す", () => {
    const found = findById("non-existent")
    expect(found).toBeNull()
  })

  it("グループでフィルタできる", () => {
    createHistory({
      id: "history-1",
      listId: "list-1",
      itemIds: ["item-1"],
      groupId: "group-1",
    })
    createHistory({
      id: "history-2",
      listId: "list-2",
      itemIds: ["item-2"],
      groupId: "group-2",
    })
    createHistory({
      id: "history-3",
      listId: "list-3",
      itemIds: ["item-3"],
      groupId: "group-1",
    })

    const group1Histories = findMany({ groupId: "group-1" })
    expect(group1Histories).toHaveLength(2)
  })

  it("ページネーションが機能する", () => {
    for (let i = 1; i <= 10; i++) {
      createHistory({
        id: `history-${i}`,
        listId: `list-${i}`,
        itemIds: [`item-${i}`],
      })
    }

    const page1 = findMany({ limit: 3, offset: 0 })
    const page2 = findMany({ limit: 3, offset: 3 })

    expect(page1).toHaveLength(3)
    expect(page2).toHaveLength(3)
  })

  it("履歴を削除できる", () => {
    createHistory({
      id: "history-1",
      listId: "list-1",
      itemIds: ["item-1"],
    })

    deleteHistory("history-1")

    expect(mockRepo.histories.size).toBe(0)
    expect(findById("history-1")).toBeNull()
  })
})

describe("履歴からのリバート", () => {
  interface MockItem {
    id: string
    name: string
    purchasedAt: Date | null
  }

  let items: Map<string, MockItem>

  beforeEach(() => {
    items = new Map()
    items.set("item-1", { id: "item-1", name: "牛乳", purchasedAt: new Date() })
    items.set("item-2", { id: "item-2", name: "パン", purchasedAt: new Date() })
  })

  function revertItems(itemIds: string[]): string[] {
    const revertedIds: string[] = []
    for (const itemId of itemIds) {
      const item = items.get(itemId)
      if (item) {
        item.purchasedAt = null
        revertedIds.push(itemId)
      }
    }
    return revertedIds
  }

  it("アイテムのpurchasedAtをnullに戻せる", () => {
    const revertedIds = revertItems(["item-1"])

    expect(revertedIds).toHaveLength(1)
    expect(items.get("item-1")?.purchasedAt).toBeNull()
    expect(items.get("item-2")?.purchasedAt).not.toBeNull()
  })

  it("複数アイテムを一度に戻せる", () => {
    const revertedIds = revertItems(["item-1", "item-2"])

    expect(revertedIds).toHaveLength(2)
    expect(items.get("item-1")?.purchasedAt).toBeNull()
    expect(items.get("item-2")?.purchasedAt).toBeNull()
  })

  it("存在しないアイテムは無視される", () => {
    const revertedIds = revertItems(["item-1", "non-existent"])

    expect(revertedIds).toHaveLength(1)
    expect(revertedIds).toContain("item-1")
  })
})
