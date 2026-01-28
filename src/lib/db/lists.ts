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

// グループIDでリストを取得（個人リストはgroupIdがundefined）
export async function getListsByGroupId(groupId: string | undefined): Promise<ShoppingList[]> {
  if (groupId === undefined) {
    // 個人リスト（グループに紐付いていないもの）
    return db.lists
      .filter((list) => list.groupId === undefined)
      .reverse()
      .sortBy("createdAt")
  }
  return db.lists.where("groupId").equals(groupId).reverse().sortBy("createdAt")
}

// グループIDで進行中のリストを取得
export async function getActiveListByGroupId(groupId: string | undefined): Promise<ShoppingList | undefined> {
  if (groupId === undefined) {
    return db.lists
      .filter((list) => list.groupId === undefined && list.status === "in_progress")
      .first()
  }
  return db.lists
    .where(["groupId", "status"])
    .equals([groupId, "in_progress"])
    .first()
}

export async function getListById(id: string): Promise<ShoppingList | undefined> {
  return db.lists.get(id)
}

export async function createList(name?: string, groupId?: string): Promise<ShoppingList> {
  const list: ShoppingList = {
    id: generateId(),
    name: name || "買い物リスト",
    status: "in_progress",
    groupId,
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
      // アイテムを「買いたいもの」に戻す（グループも保持）
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
            groupId: item.groupId,
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
  items: { name: string; quantity: number; memo?: string; tagIds?: string[]; groupId?: string }[]
): Promise<void> {
  const now = new Date()
  const listItems: ListItem[] = items.map((item) => ({
    id: generateId(),
    listId,
    name: item.name,
    quantity: item.quantity,
    memo: item.memo,
    tagIds: item.tagIds ?? [],
    groupId: item.groupId,
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
  memo?: string,
  groupId?: string
): Promise<ListItem> {
  const listItem: ListItem = {
    id: generateId(),
    listId,
    name,
    quantity,
    memo,
    tagIds,
    groupId,
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

    // 買いたいものに戻す（タグ・メモ・グループを保持）
    const now = new Date()
    await db.items.add({
      id: generateId(),
      name: listItem.name,
      quantity: listItem.quantity,
      memo: listItem.memo,
      tagIds: listItem.tagIds ?? [],
      groupId: listItem.groupId,
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

// グループIDで購入履歴を取得
export async function getHistoryByGroupId(groupId: string | undefined): Promise<PurchaseHistory[]> {
  if (groupId === undefined) {
    // 個人の履歴（グループに紐付いていないもの）
    return db.history
      .filter((h) => h.groupId === undefined)
      .reverse()
      .sortBy("purchasedAt")
  }
  return db.history.where("groupId").equals(groupId).reverse().sortBy("purchasedAt")
}

export async function getHistoryById(
  id: string
): Promise<PurchaseHistory | undefined> {
  return db.history.get(id)
}

export async function createHistory(
  listId: string,
  location: string | undefined,
  itemIds: string[],
  groupId?: string
): Promise<PurchaseHistory> {
  const history: PurchaseHistory = {
    id: generateId(),
    listId,
    location,
    itemIds,
    groupId,
    purchasedAt: new Date(),
  }
  await db.history.add(history)
  return history
}

// 購入履歴を買い物リストに戻す
export async function revertHistoryToList(historyId: string): Promise<ShoppingList> {
  return db.transaction(
    "rw",
    [db.history, db.lists, db.listItems, db.items],
    async () => {
      const history = await db.history.get(historyId)
      if (!history) {
        throw new Error("History not found")
      }

      // 購入済みアイテムを取得
      const purchasedItems = await db.items.bulkGet(history.itemIds)
      const validItems = purchasedItems.filter((item) => item !== undefined)

      // 新しい買い物リストを作成（グループも保持）
      const list: ShoppingList = {
        id: generateId(),
        name: history.location || "買い物リスト",
        status: "in_progress",
        groupId: history.groupId,
        createdAt: new Date(),
      }
      await db.lists.add(list)

      // アイテムをListItemとして追加（グループも保持）
      if (validItems.length > 0) {
        const now = new Date()
        const listItems: ListItem[] = validItems.map((item) => ({
          id: generateId(),
          listId: list.id,
          name: item!.name,
          quantity: item!.quantity,
          memo: item!.memo,
          tagIds: item!.tagIds ?? [],
          groupId: item!.groupId ?? history.groupId,
          checked: false,
          createdAt: now,
        }))
        await db.listItems.bulkAdd(listItems)
      }

      // 購入済みアイテムを削除
      await db.items.bulkDelete(history.itemIds)

      // 履歴を削除
      await db.history.delete(historyId)

      return list
    }
  )
}

// 購入履歴を削除（アイテムも一緒に削除）
export async function deleteHistory(historyId: string): Promise<void> {
  await db.transaction("rw", [db.history, db.items], async () => {
    const history = await db.history.get(historyId)
    if (!history) return

    // 紐付くアイテムを削除
    await db.items.bulkDelete(history.itemIds)

    // 履歴を削除
    await db.history.delete(historyId)
  })
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
      // リストを取得してgroupIdを確認
      const list = await db.lists.get(listId)
      const groupId = list?.groupId

      const listItems = await db.listItems.where("listId").equals(listId).toArray()
      const purchasedItems = listItems.filter((item) => item.checked)
      const unpurchasedItems = listItems.filter((item) => !item.checked)

      const now = new Date()

      // 購入済みアイテムをShoppingItemとして保存（purchasedAt付き、グループも保持）
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
            groupId: item.groupId ?? groupId,
            purchasedAt: now,
            createdAt: now,
            updatedAt: now,
          }
        })
        await db.items.bulkAdd(purchasedShoppingItems)

        // 購入履歴を作成（アイテムIDを参照、グループも保持）
        await createHistory(listId, location, purchasedItemIds, groupId)
      }

      // 未チェックアイテムを「買いたいもの」に戻す（purchasedAtなし、グループも保持）
      if (unpurchasedItems.length > 0) {
        await db.items.bulkAdd(
          unpurchasedItems.map((item) => ({
            id: generateId(),
            name: item.name,
            quantity: item.quantity,
            memo: item.memo,
            tagIds: item.tagIds ?? [],
            groupId: item.groupId ?? groupId,
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
