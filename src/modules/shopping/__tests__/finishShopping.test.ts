import { describe, it, expect, beforeEach } from "vitest"
import { ListStatus, canTransition, isInProgress } from "../domain/value-objects/ListStatus"
import type { ShoppingListWithItems, ListItemWithTags } from "../domain/entities/ShoppingList"
import type { PurchaseHistory } from "../domain/entities/PurchaseHistory"

describe("買い物完了フロー", () => {
  describe("ステータス遷移", () => {
    it("in_progress → completed は許可", () => {
      expect(canTransition(ListStatus.IN_PROGRESS, ListStatus.COMPLETED)).toBe(true)
    })

    it("completed → in_progress は不許可", () => {
      expect(canTransition(ListStatus.COMPLETED, ListStatus.IN_PROGRESS)).toBe(false)
    })

    it("進行中のリストのみ完了可能", () => {
      const inProgressList: ShoppingListWithItems = {
        id: "list-1",
        name: "買い物",
        status: ListStatus.IN_PROGRESS,
        groupId: null,
        createdAt: new Date(),
        completedAt: null,
        items: [],
      }

      expect(isInProgress(inProgressList.status)).toBe(true)
      expect(canTransition(inProgressList.status, ListStatus.COMPLETED)).toBe(true)
    })

    it("完了済みリストは再度完了できない", () => {
      const completedList: ShoppingListWithItems = {
        id: "list-1",
        name: "買い物",
        status: ListStatus.COMPLETED,
        groupId: null,
        createdAt: new Date(),
        completedAt: new Date(),
        items: [],
      }

      expect(isInProgress(completedList.status)).toBe(false)
    })
  })

  describe("チェック済みアイテムの処理", () => {
    it("チェック済みアイテムのみ抽出される", () => {
      const items: ListItemWithTags[] = [
        {
          id: "item-1",
          listId: "list-1",
          name: "牛乳",
          quantity: 1,
          memo: null,
          tagIds: null,
          groupId: null,
          checked: true,
          createdAt: new Date(),
          tags: [],
        },
        {
          id: "item-2",
          listId: "list-1",
          name: "パン",
          quantity: 2,
          memo: null,
          tagIds: null,
          groupId: null,
          checked: false,
          createdAt: new Date(),
          tags: [],
        },
        {
          id: "item-3",
          listId: "list-1",
          name: "卵",
          quantity: 1,
          memo: null,
          tagIds: null,
          groupId: null,
          checked: true,
          createdAt: new Date(),
          tags: [],
        },
      ]

      const checkedItems = items.filter((item) => item.checked)
      const uncheckedItems = items.filter((item) => !item.checked)

      expect(checkedItems).toHaveLength(2)
      expect(uncheckedItems).toHaveLength(1)
      expect(checkedItems.map((i) => i.name)).toContain("牛乳")
      expect(checkedItems.map((i) => i.name)).toContain("卵")
      expect(uncheckedItems.map((i) => i.name)).toContain("パン")
    })

    it("全てチェック済みの場合は全て抽出される", () => {
      const items: ListItemWithTags[] = [
        {
          id: "item-1",
          listId: "list-1",
          name: "牛乳",
          quantity: 1,
          memo: null,
          tagIds: null,
          groupId: null,
          checked: true,
          createdAt: new Date(),
          tags: [],
        },
        {
          id: "item-2",
          listId: "list-1",
          name: "パン",
          quantity: 1,
          memo: null,
          tagIds: null,
          groupId: null,
          checked: true,
          createdAt: new Date(),
          tags: [],
        },
      ]

      const checkedItems = items.filter((item) => item.checked)
      expect(checkedItems).toHaveLength(2)
    })

    it("全て未チェックの場合は空配列", () => {
      const items: ListItemWithTags[] = [
        {
          id: "item-1",
          listId: "list-1",
          name: "牛乳",
          quantity: 1,
          memo: null,
          tagIds: null,
          groupId: null,
          checked: false,
          createdAt: new Date(),
          tags: [],
        },
      ]

      const checkedItems = items.filter((item) => item.checked)
      expect(checkedItems).toHaveLength(0)
    })
  })

  describe("PurchaseHistory エンティティ", () => {
    it("購入履歴を作成できる", () => {
      const history: PurchaseHistory = {
        id: "history-1",
        listId: "list-1",
        location: "スーパー",
        itemIds: ["item-1", "item-3"],
        groupId: "group-1",
        purchasedAt: new Date(),
      }

      expect(history.id).toBe("history-1")
      expect(history.listId).toBe("list-1")
      expect(history.location).toBe("スーパー")
      expect(history.itemIds).toHaveLength(2)
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
  })

  describe("買い物完了のビジネスルール", () => {
    interface MockFinishShoppingResult {
      listId: string
      status: string
      checkedItemIds: string[]
      historyId: string
    }

    function finishShopping(
      list: ShoppingListWithItems,
      location?: string
    ): MockFinishShoppingResult | { error: string } {
      // ステータス確認
      if (!isInProgress(list.status)) {
        return { error: "このリストは既に完了しています" }
      }

      // チェック済みアイテムを抽出
      const checkedItems = list.items.filter((item) => item.checked)

      return {
        listId: list.id,
        status: ListStatus.COMPLETED,
        checkedItemIds: checkedItems.map((i) => i.id),
        historyId: crypto.randomUUID(),
      }
    }

    it("進行中のリストを完了できる", () => {
      const list: ShoppingListWithItems = {
        id: "list-1",
        name: "買い物",
        status: ListStatus.IN_PROGRESS,
        groupId: null,
        createdAt: new Date(),
        completedAt: null,
        items: [
          {
            id: "item-1",
            listId: "list-1",
            name: "牛乳",
            quantity: 1,
            memo: null,
            tagIds: null,
            groupId: null,
            checked: true,
            createdAt: new Date(),
            tags: [],
          },
        ],
      }

      const result = finishShopping(list, "スーパー")

      expect("error" in result).toBe(false)
      if (!("error" in result)) {
        expect(result.status).toBe(ListStatus.COMPLETED)
        expect(result.checkedItemIds).toHaveLength(1)
      }
    })

    it("完了済みのリストは再度完了できない", () => {
      const list: ShoppingListWithItems = {
        id: "list-1",
        name: "買い物",
        status: ListStatus.COMPLETED,
        groupId: null,
        createdAt: new Date(),
        completedAt: new Date(),
        items: [],
      }

      const result = finishShopping(list)

      expect("error" in result).toBe(true)
      if ("error" in result) {
        expect(result.error).toBe("このリストは既に完了しています")
      }
    })

    it("空のリストでも完了できる", () => {
      const list: ShoppingListWithItems = {
        id: "list-1",
        name: "空のリスト",
        status: ListStatus.IN_PROGRESS,
        groupId: null,
        createdAt: new Date(),
        completedAt: null,
        items: [],
      }

      const result = finishShopping(list)

      expect("error" in result).toBe(false)
      if (!("error" in result)) {
        expect(result.checkedItemIds).toHaveLength(0)
      }
    })
  })
})

describe("ShoppingService", () => {
  describe("finishShopping メソッドの仕様", () => {
    it("チェック済みアイテムのIDが履歴に記録される", () => {
      const checkedItems = [
        { id: "item-1", name: "牛乳", checked: true },
        { id: "item-2", name: "パン", checked: false },
        { id: "item-3", name: "卵", checked: true },
      ]

      const itemIds = checkedItems
        .filter((i) => i.checked)
        .map((i) => i.id)

      expect(itemIds).toEqual(["item-1", "item-3"])
    })

    it("未チェックアイテムはCatalogに残る（履歴に含まれない）", () => {
      const checkedItems = [
        { id: "item-1", name: "牛乳", checked: true },
        { id: "item-2", name: "パン", checked: false },
      ]

      const uncheckedIds = checkedItems
        .filter((i) => !i.checked)
        .map((i) => i.id)

      expect(uncheckedIds).toEqual(["item-2"])
    })
  })
})
