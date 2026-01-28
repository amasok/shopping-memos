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
