import { db, generateId, type ShoppingItem } from "./index"

export async function getItems(): Promise<ShoppingItem[]> {
  return db.items.orderBy("createdAt").reverse().toArray()
}

export async function getItemById(id: string): Promise<ShoppingItem | undefined> {
  return db.items.get(id)
}

export async function getItemsByTagId(tagId: string): Promise<ShoppingItem[]> {
  return db.items.where("tagIds").equals(tagId).toArray()
}

// グループIDでアイテムを取得（個人アイテムはgroupIdがundefined）
export async function getItemsByGroupId(groupId: string | undefined): Promise<ShoppingItem[]> {
  if (groupId === undefined) {
    // 個人アイテム（グループに紐付いていないもの）
    return db.items
      .filter((item) => item.groupId === undefined)
      .reverse()
      .sortBy("createdAt")
  }
  return db.items.where("groupId").equals(groupId).reverse().sortBy("createdAt")
}

// 未購入アイテムをグループIDでフィルタリング
export async function getUnpurchasedItemsByGroupId(groupId: string | undefined): Promise<ShoppingItem[]> {
  const items = await getItemsByGroupId(groupId)
  return items.filter((item) => item.purchasedAt === undefined)
}

export async function createItem(
  data: Omit<ShoppingItem, "id" | "createdAt" | "updatedAt">
): Promise<ShoppingItem> {
  const now = new Date()
  const item: ShoppingItem = {
    id: generateId(),
    ...data,
    createdAt: now,
    updatedAt: now,
  }
  await db.items.add(item)
  return item
}

export async function updateItem(
  id: string,
  data: Partial<Omit<ShoppingItem, "id" | "createdAt">>
): Promise<void> {
  await db.items.update(id, {
    ...data,
    updatedAt: new Date(),
  })
}

export async function deleteItem(id: string): Promise<void> {
  await db.items.delete(id)
}

export async function deleteItems(ids: string[]): Promise<void> {
  await db.items.bulkDelete(ids)
}
