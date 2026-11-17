import type { ShoppingItem, Tag } from "@/lib/db"
import { createRecord, deleteRecord, updateRecord, type LocalStore } from "./repository"

/**
 * カタログ（商品・タグ）の端末の DB のリポジトリ（#62 O7。openspec の catalog「ローカルファーストの書き込みと同期のキュー」）
 *
 * ゲスト（queue: false）とローカルファースト（queue: true）の両方がここを通る。
 * キューのパッチは sync.push の検証（pushPatches.ts）の範囲で、今の tRPC の mutation が送るものと同じにする
 * （フラグの切り替えで振る舞いを変えない。design.md D2）
 */

export interface CreateItemInput {
  name: string
  quantity: number
  memo?: string | null
  tagIds: string[]
  groupId?: string | null
}

export interface UpdateItemInput {
  id: string
  name?: string
  quantity?: number
  memo?: string | null
  tagIds?: string[]
  groupId?: string | null
}

export interface CreateTagInput {
  name: string
  groupId?: string | null
}

/** 値があるフィールドだけを残す（null・undefined は送らない。今の tRPC の `?? undefined` と同じ） */
function present<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>
}

export async function createItem(store: LocalStore, input: CreateItemInput): Promise<ShoppingItem> {
  const now = store.clock.now()
  const record: Omit<ShoppingItem, "updatedAt"> = {
    id: crypto.randomUUID(),
    name: input.name,
    quantity: input.quantity,
    memo: input.memo ?? undefined,
    tagIds: [...input.tagIds],
    groupId: input.groupId ?? undefined,
    createdAt: now,
  }
  const patch = present({
    name: input.name,
    quantity: input.quantity,
    memo: input.memo,
    tagIds: [...input.tagIds],
    groupId: input.groupId,
  })
  return createRecord<ShoppingItem>(store, "items", record, patch)
}

/**
 * 商品を更新する
 * - ローカルファースト: 今の tRPC の updateItem と同じく、name・quantity・tagIds と、値があるときの memo だけを変えて送る
 *   （メモの null は送らない。groupId・purchasedAt は変えない）
 * - ゲスト: 今と同じく、渡されたフィールドをそのまま書く（updatedAt も更新する）
 */
export async function updateItem(store: LocalStore, input: UpdateItemInput): Promise<void> {
  const { id, ...fields } = input
  const patch = present({ name: fields.name, quantity: fields.quantity, memo: fields.memo, tagIds: fields.tagIds })
  const changes = store.queue
    ? (patch as Partial<ShoppingItem>)
    : ({ ...fields, memo: fields.memo ?? undefined, groupId: fields.groupId ?? undefined } as Partial<ShoppingItem>)
  await updateRecord<ShoppingItem>(store, "items", id, changes, patch)
}

export async function deleteItem(store: LocalStore, id: string): Promise<void> {
  await deleteRecord(store, "items", id)
}

export async function createTag(store: LocalStore, input: CreateTagInput): Promise<Tag> {
  const now = store.clock.now()
  const record: Omit<Tag, "updatedAt"> = {
    id: crypto.randomUUID(),
    name: input.name,
    groupId: input.groupId ?? undefined,
    createdAt: now,
  }
  return createRecord<Tag>(store, "tags", record, present({ name: input.name, groupId: input.groupId }))
}

export async function updateTag(store: LocalStore, input: { id: string; name: string }): Promise<void> {
  await updateRecord<Tag>(store, "tags", input.id, { name: input.name }, { name: input.name })
}

/**
 * タグを消し、商品の tagIds からも外す（1 トランザクション）
 * 外した商品ごとに update {tagIds} もキューに積む。積まないと、送る前のタグの create + delete が圧縮で両方消えたとき、
 * 送る前の商品のパッチに消えたタグが残り、サーバーで参照の不正として拒否される（design.md D2）
 */
export async function deleteTag(store: LocalStore, id: string): Promise<void> {
  const { db } = store
  await db.transaction("rw", [db.tags, db.items, db.syncQueue], async () => {
    await deleteRecord(store, "tags", id)
    const tagged = await db.items.where("tagIds").equals(id).toArray()
    for (const item of tagged) {
      const tagIds = item.tagIds.filter((tagId) => tagId !== id)
      await updateRecord<ShoppingItem>(store, "items", item.id, { tagIds }, { tagIds })
    }
  })
}
