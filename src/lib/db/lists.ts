import {
  db,
  generateId,
  type ShoppingList,
  type ListItem,
  type PurchaseHistory,
} from "./index"

// Shopping Lists
export async function getLists(): Promise<ShoppingList[]> {
  return db.lists.orderBy("createdAt").reverse().toArray()
}

export async function getActiveList(): Promise<ShoppingList | undefined> {
  return db.lists.where("status").equals("in_progress").first()
}

export async function getListById(id: string): Promise<ShoppingList | undefined> {
  return db.lists.get(id)
}

export async function createList(name?: string): Promise<ShoppingList> {
  const list: ShoppingList = {
    id: generateId(),
    name: name || "買い物リスト",
    status: "in_progress",
    createdAt: new Date(),
  }
  await db.lists.add(list)
  return list
}

export async function completeList(id: string): Promise<void> {
  await db.lists.update(id, {
    status: "completed",
    completedAt: new Date(),
  })
}

export async function updateList(
  id: string,
  data: Partial<Omit<ShoppingList, "id" | "createdAt">>
): Promise<void> {
  await db.lists.update(id, data)
}

// リスト削除（アイテムの処理方法を選択可能）
export async function deleteList(
  id: string,
  itemHandling: "delete" | "return" = "delete"
): Promise<void> {
  await db.transaction("rw", [db.lists, db.listItems, db.items], async () => {
    if (itemHandling === "return") {
      // アイテムを「買いたいもの」に戻す
      const listItems = await db.listItems.where("listId").equals(id).toArray()
      if (listItems.length > 0) {
        const now = new Date()
        await db.items.bulkAdd(
          listItems.map((item) => ({
            id: generateId(),
            name: item.name,
            quantity: item.quantity,
            memo: item.memo,
            tagIds: item.tagIds ?? [],
            createdAt: now,
            updatedAt: now,
          }))
        )
      }
    }
    await db.listItems.where("listId").equals(id).delete()
    await db.lists.delete(id)
  })
}

// 進行中のリスト数を取得
export async function getActiveListCount(): Promise<number> {
  return db.lists.where("status").equals("in_progress").count()
}

// List Items
export async function getListItems(listId: string): Promise<ListItem[]> {
  return db.listItems.where("listId").equals(listId).toArray()
}

export async function addListItems(
  listId: string,
  items: { name: string; quantity: number; memo?: string; tagIds?: string[] }[]
): Promise<void> {
  const now = new Date()
  const listItems: ListItem[] = items.map((item) => ({
    id: generateId(),
    listId,
    name: item.name,
    quantity: item.quantity,
    memo: item.memo,
    tagIds: item.tagIds ?? [],
    checked: false,
    createdAt: now,
  }))
  await db.listItems.bulkAdd(listItems)
}

export async function toggleListItem(id: string, checked: boolean): Promise<void> {
  await db.listItems.update(id, { checked })
}

export async function addListItem(
  listId: string,
  name: string,
  quantity: number = 1,
  tagIds: string[] = [],
  memo?: string
): Promise<ListItem> {
  const listItem: ListItem = {
    id: generateId(),
    listId,
    name,
    quantity,
    memo,
    tagIds,
    checked: false,
    createdAt: new Date(),
  }
  await db.listItems.add(listItem)
  return listItem
}

export async function deleteListItem(id: string): Promise<void> {
  await db.listItems.delete(id)
}

// リストからアイテムを外して「買いたいもの」に戻す
export async function removeListItemAndReturnToItems(id: string): Promise<void> {
  await db.transaction("rw", [db.listItems, db.items], async () => {
    const listItem = await db.listItems.get(id)
    if (!listItem) return

    // 買いたいものに戻す（タグ・メモを保持）
    const now = new Date()
    await db.items.add({
      id: generateId(),
      name: listItem.name,
      quantity: listItem.quantity,
      memo: listItem.memo,
      tagIds: listItem.tagIds ?? [],
      createdAt: now,
      updatedAt: now,
    })

    // リストから削除
    await db.listItems.delete(id)
  })
}

// Purchase History
export async function getHistory(): Promise<PurchaseHistory[]> {
  return db.history.orderBy("purchasedAt").reverse().toArray()
}

export async function getHistoryById(
  id: string
): Promise<PurchaseHistory | undefined> {
  return db.history.get(id)
}

export async function createHistory(
  listId: string,
  location: string | undefined,
  itemIds: string[]
): Promise<PurchaseHistory> {
  const history: PurchaseHistory = {
    id: generateId(),
    listId,
    location,
    itemIds,
    purchasedAt: new Date(),
  }
  await db.history.add(history)
  return history
}

// 買い物完了処理（リスト完了 + 履歴作成 + 未チェックアイテムを買いたいものに戻す）
export async function finishShopping(
  listId: string,
  location?: string
): Promise<{ purchasedItems: ListItem[]; unpurchasedItems: ListItem[] }> {
  return db.transaction(
    "rw",
    [db.lists, db.listItems, db.history, db.items],
    async () => {
      const listItems = await db.listItems.where("listId").equals(listId).toArray()
      const purchasedItems = listItems.filter((item) => item.checked)
      const unpurchasedItems = listItems.filter((item) => !item.checked)

      const now = new Date()

      // 購入済みアイテムをShoppingItemとして保存（purchasedAt付き）
      const purchasedItemIds: string[] = []
      if (purchasedItems.length > 0) {
        const purchasedShoppingItems = purchasedItems.map((item) => {
          const id = generateId()
          purchasedItemIds.push(id)
          return {
            id,
            name: item.name,
            quantity: item.quantity,
            memo: item.memo,
            tagIds: item.tagIds ?? [],
            purchasedAt: now,
            createdAt: now,
            updatedAt: now,
          }
        })
        await db.items.bulkAdd(purchasedShoppingItems)

        // 購入履歴を作成（アイテムIDを参照）
        await createHistory(listId, location, purchasedItemIds)
      }

      // 未チェックアイテムを「買いたいもの」に戻す（purchasedAtなし）
      if (unpurchasedItems.length > 0) {
        await db.items.bulkAdd(
          unpurchasedItems.map((item) => ({
            id: generateId(),
            name: item.name,
            quantity: item.quantity,
            memo: item.memo,
            tagIds: item.tagIds ?? [],
            createdAt: now,
            updatedAt: now,
          }))
        )
      }

      // リストのアイテムを削除
      await db.listItems.where("listId").equals(listId).delete()

      // リストを完了
      await completeList(listId)

      return { purchasedItems, unpurchasedItems }
    }
  )
}
