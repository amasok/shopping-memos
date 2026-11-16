import { db, generateId, type Tag } from "./index"

export async function getTags(): Promise<Tag[]> {
  return db.tags.orderBy("createdAt").toArray()
}

export async function getTagById(id: string): Promise<Tag | undefined> {
  return db.tags.get(id)
}

export async function getTagsByIds(ids: string[]): Promise<Tag[]> {
  return db.tags.where("id").anyOf(ids).toArray()
}

// グループIDでタグを取得（個人タグはgroupIdがundefined）
export async function getTagsByGroupId(groupId: string | undefined): Promise<Tag[]> {
  if (groupId === undefined) {
    // 個人タグ（グループに紐付いていないもの）
    return db.tags.filter((tag) => tag.groupId === undefined).toArray()
  }
  return db.tags.where("groupId").equals(groupId).toArray()
}

export async function createTag(name: string, groupId?: string): Promise<Tag> {
  const now = new Date()
  const tag: Tag = {
    id: generateId(),
    name,
    groupId,
    createdAt: now,
    updatedAt: now,
  }
  await db.tags.add(tag)
  return tag
}

export async function updateTag(id: string, name: string): Promise<void> {
  await db.tags.update(id, {
    name,
    updatedAt: new Date(),
  })
}

export async function deleteTag(id: string): Promise<void> {
  // タグを削除し、アイテムからも参照を削除
  await db.transaction("rw", [db.tags, db.items], async () => {
    await db.tags.delete(id)

    // このタグを持つアイテムからタグを除去
    const items = await db.items.where("tagIds").equals(id).toArray()
    for (const item of items) {
      await db.items.update(item.id, {
        tagIds: item.tagIds.filter((tagId) => tagId !== id),
        updatedAt: new Date(),
      })
    }
  })
}

/** ゲストの初期タグの名前（DB が空のときに作る） */
export const DEFAULT_TAG_NAMES = ["食品", "日用品", "エンタメ"] as const

// デフォルトタグを初期化
export async function initializeDefaultTags(): Promise<void> {
  const count = await db.tags.count()
  if (count === 0) {
    const now = new Date()
    await db.tags.bulkAdd(
      DEFAULT_TAG_NAMES.map((name) => ({
        id: generateId(),
        name,
        createdAt: now,
        updatedAt: now,
      }))
    )
  }
}
