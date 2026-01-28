import { describe, it, expect, beforeEach } from "vitest"
import {
  ListStatus,
  canTransition,
  isInProgress,
  isCompleted,
} from "../domain/value-objects/ListStatus"
import type { ShoppingList, ShoppingListWithItems } from "../domain/entities/ShoppingList"
import type { ListItem } from "../domain/entities/ListItem"

describe("ListStatus 値オブジェクト", () => {
  describe("canTransition", () => {
    it("in_progress → completed は許可", () => {
      expect(canTransition(ListStatus.IN_PROGRESS, ListStatus.COMPLETED)).toBe(true)
    })

    it("completed → in_progress は不許可", () => {
      expect(canTransition(ListStatus.COMPLETED, ListStatus.IN_PROGRESS)).toBe(false)
    })

    it("同じステータスへの遷移は不許可", () => {
      expect(canTransition(ListStatus.IN_PROGRESS, ListStatus.IN_PROGRESS)).toBe(false)
      expect(canTransition(ListStatus.COMPLETED, ListStatus.COMPLETED)).toBe(false)
    })
  })

  describe("isInProgress", () => {
    it("in_progressの場合はtrue", () => {
      expect(isInProgress(ListStatus.IN_PROGRESS)).toBe(true)
    })

    it("completedの場合はfalse", () => {
      expect(isInProgress(ListStatus.COMPLETED)).toBe(false)
    })
  })

  describe("isCompleted", () => {
    it("completedの場合はtrue", () => {
      expect(isCompleted(ListStatus.COMPLETED)).toBe(true)
    })

    it("in_progressの場合はfalse", () => {
      expect(isCompleted(ListStatus.IN_PROGRESS)).toBe(false)
    })
  })
})

describe("ShoppingList エンティティ", () => {
  describe("リスト作成", () => {
    it("新しいリストを作成できる", () => {
      const list: ShoppingList = {
        id: "list-1",
        name: "今日の買い物",
        status: ListStatus.IN_PROGRESS,
        groupId: "group-1",
        createdAt: new Date(),
        completedAt: null,
      }

      expect(list.id).toBe("list-1")
      expect(list.name).toBe("今日の買い物")
      expect(list.status).toBe(ListStatus.IN_PROGRESS)
      expect(list.completedAt).toBeNull()
    })

    it("グループなしのリストを作成できる", () => {
      const list: ShoppingList = {
        id: "list-2",
        name: "個人の買い物",
        status: ListStatus.IN_PROGRESS,
        groupId: null,
        createdAt: new Date(),
        completedAt: null,
      }

      expect(list.groupId).toBeNull()
    })
  })

  describe("アイテム付きリスト", () => {
    it("アイテム付きのリストを取得できる", () => {
      const listWithItems: ShoppingListWithItems = {
        id: "list-1",
        name: "今日の買い物",
        status: ListStatus.IN_PROGRESS,
        groupId: "group-1",
        createdAt: new Date(),
        completedAt: null,
        items: [
          {
            id: "item-1",
            listId: "list-1",
            name: "牛乳",
            quantity: 1,
            memo: null,
            tagIds: ["tag-1"],
            groupId: "group-1",
            checked: false,
            createdAt: new Date(),
            tags: [{ id: "tag-1", name: "食品" }],
          },
        ],
      }

      expect(listWithItems.items).toHaveLength(1)
      expect(listWithItems.items[0].name).toBe("牛乳")
      expect(listWithItems.items[0].tags).toHaveLength(1)
    })
  })
})

describe("ListItem エンティティ", () => {
  describe("アイテム作成", () => {
    it("新しいリストアイテムを作成できる", () => {
      const item: ListItem = {
        id: "item-1",
        listId: "list-1",
        name: "牛乳",
        quantity: 2,
        memo: "低脂肪",
        tagIds: ["tag-1", "tag-2"],
        groupId: "group-1",
        checked: false,
        createdAt: new Date(),
      }

      expect(item.name).toBe("牛乳")
      expect(item.quantity).toBe(2)
      expect(item.memo).toBe("低脂肪")
      expect(item.tagIds).toHaveLength(2)
      expect(item.checked).toBe(false)
    })

    it("メモなし・タグなしのアイテムを作成できる", () => {
      const item: ListItem = {
        id: "item-2",
        listId: "list-1",
        name: "パン",
        quantity: 1,
        memo: null,
        tagIds: null,
        groupId: null,
        checked: false,
        createdAt: new Date(),
      }

      expect(item.memo).toBeNull()
      expect(item.tagIds).toBeNull()
    })
  })

  describe("チェック状態", () => {
    it("アイテムをチェック済みにできる", () => {
      const item: ListItem = {
        id: "item-1",
        listId: "list-1",
        name: "牛乳",
        quantity: 1,
        memo: null,
        tagIds: null,
        groupId: null,
        checked: true,
        createdAt: new Date(),
      }

      expect(item.checked).toBe(true)
    })
  })
})

describe("ShoppingListRepository インターフェース", () => {
  interface MockShoppingListRepository {
    lists: Map<string, ShoppingListWithItems>
    items: Map<string, ListItem>
  }

  let mockRepo: MockShoppingListRepository

  beforeEach(() => {
    mockRepo = {
      lists: new Map(),
      items: new Map(),
    }
  })

  function createList(input: { id: string; name: string; groupId?: string }): ShoppingList {
    const list: ShoppingListWithItems = {
      id: input.id,
      name: input.name,
      status: ListStatus.IN_PROGRESS,
      groupId: input.groupId ?? null,
      createdAt: new Date(),
      completedAt: null,
      items: [],
    }
    mockRepo.lists.set(input.id, list)
    return list
  }

  function addItem(input: {
    id: string
    listId: string
    name: string
    quantity: number
  }): ListItem {
    const item: ListItem = {
      id: input.id,
      listId: input.listId,
      name: input.name,
      quantity: input.quantity,
      memo: null,
      tagIds: null,
      groupId: null,
      checked: false,
      createdAt: new Date(),
    }
    mockRepo.items.set(input.id, item)

    const list = mockRepo.lists.get(input.listId)
    if (list) {
      list.items.push({ ...item, tags: [] })
    }
    return item
  }

  function checkItem(id: string, checked: boolean): ListItem | null {
    const item = mockRepo.items.get(id)
    if (!item) return null

    item.checked = checked
    return item
  }

  it("リストを作成できる", () => {
    const list = createList({
      id: "list-1",
      name: "今日の買い物",
      groupId: "group-1",
    })

    expect(list.id).toBe("list-1")
    expect(list.name).toBe("今日の買い物")
    expect(mockRepo.lists.size).toBe(1)
  })

  it("リストにアイテムを追加できる", () => {
    createList({ id: "list-1", name: "買い物" })

    const item = addItem({
      id: "item-1",
      listId: "list-1",
      name: "牛乳",
      quantity: 1,
    })

    expect(item.name).toBe("牛乳")
    expect(mockRepo.lists.get("list-1")?.items).toHaveLength(1)
  })

  it("アイテムのチェック状態を変更できる", () => {
    createList({ id: "list-1", name: "買い物" })
    addItem({ id: "item-1", listId: "list-1", name: "牛乳", quantity: 1 })

    const updated = checkItem("item-1", true)

    expect(updated?.checked).toBe(true)
  })

  it("複数のアイテムを追加できる", () => {
    createList({ id: "list-1", name: "買い物" })
    addItem({ id: "item-1", listId: "list-1", name: "牛乳", quantity: 1 })
    addItem({ id: "item-2", listId: "list-1", name: "パン", quantity: 2 })
    addItem({ id: "item-3", listId: "list-1", name: "卵", quantity: 1 })

    expect(mockRepo.lists.get("list-1")?.items).toHaveLength(3)
  })
})

describe("買い物リストのビジネスルール", () => {
  it("完了したリストのステータスは in_progress に戻せない", () => {
    const list: ShoppingList = {
      id: "list-1",
      name: "完了したリスト",
      status: ListStatus.COMPLETED,
      groupId: null,
      createdAt: new Date(),
      completedAt: new Date(),
    }

    expect(canTransition(list.status, ListStatus.IN_PROGRESS)).toBe(false)
  })

  it("進行中のリストは完了にできる", () => {
    const list: ShoppingList = {
      id: "list-1",
      name: "進行中のリスト",
      status: ListStatus.IN_PROGRESS,
      groupId: null,
      createdAt: new Date(),
      completedAt: null,
    }

    expect(canTransition(list.status, ListStatus.COMPLETED)).toBe(true)
  })
})
