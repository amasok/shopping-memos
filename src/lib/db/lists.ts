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

export async function deleteList(id: string): Promise<void> {
  await db.transaction("rw", [db.lists, db.listItems], async () => {
    await db.lists.delete(id)
    await db.listItems.where("listId").equals(id).delete()
  })
}

// List Items
export async function getListItems(listId: string): Promise<ListItem[]> {
  return db.listItems.where("listId").equals(listId).toArray()
}

export async function addListItems(
  listId: string,
  items: { name: string; quantity: number }[]
): Promise<void> {
  const now = new Date()
  const listItems: ListItem[] = items.map((item) => ({
    id: generateId(),
    listId,
    name: item.name,
    quantity: item.quantity,
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
  quantity: number = 1
): Promise<ListItem> {
  const listItem: ListItem = {
    id: generateId(),
    listId,
    name,
    quantity,
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

    // 買いたいものに戻す
    const now = new Date()
    await db.items.add({
      id: generateId(),
      name: listItem.name,
      quantity: listItem.quantity,
      tagIds: [],
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
  items: { name: string; quantity: number }[]
): Promise<PurchaseHistory> {
  const history: PurchaseHistory = {
    id: generateId(),
    listId,
    location,
    items,
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

      // 購入履歴を作成
      if (purchasedItems.length > 0) {
        await createHistory(
          listId,
          location,
          purchasedItems.map((item) => ({
            name: item.name,
            quantity: item.quantity,
          }))
        )
      }

      // リストを完了
      await completeList(listId)

      return { purchasedItems, unpurchasedItems }
    }
  )
}
