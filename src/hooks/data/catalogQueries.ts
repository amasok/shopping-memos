import type { ShoppingItem, ShoppingMemosDB, Tag } from "@/lib/db"
import { excludeItemsInActiveLists } from "@/modules/shopping/domain/services/activeListExclusion"

/**
 * 端末の DB（ゲスト DB・ユーザー DB）からカタログの一覧を読む（#62 O7。openspec の catalog「商品の一覧の絞り込み」「タグの一覧」）
 *
 * 並びは order で分ける（design.md D3）
 * - server: ローカルファースト。サーバーと同じく商品は作成日時の古い順、タグは名前の文字コードの順
 * - guest: ゲスト。今のまま（商品は新しい順、タグは並べ替えない）。そろえるかは 62-o7b でユーザーに確認する
 */

export type CatalogOrder = "server" | "guest"

export interface ItemQueryOptions {
  /** 選んでいるグループ（個人なら undefined） */
  groupId: string | undefined
  tagIds?: string[]
  includePurchased?: boolean
  purchasedOnly?: boolean
  order: CatalogOrder
}

/** 同じグループの、進行中のリストに残っている商品の名前 */
async function namesInActiveLists(db: ShoppingMemosDB, groupId: string | undefined): Promise<string[]> {
  const activeListIds = (await db.lists.filter((l) => l.status === "in_progress" && l.groupId === groupId).toArray()).map(
    (l) => l.id
  )
  if (activeListIds.length === 0) return []
  const entries = await db.listItems.where("listId").anyOf(activeListIds).toArray()
  return entries.map((e) => e.name)
}

export async function queryItems(db: ShoppingMemosDB, options: ItemQueryOptions): Promise<ShoppingItem[]> {
  const { groupId, tagIds, includePurchased, purchasedOnly, order } = options
  const ordered = order === "server" ? db.items.orderBy("createdAt") : db.items.orderBy("createdAt").reverse()
  const items = await ordered
    .filter((item) => {
      if (item.groupId !== groupId) return false
      if (purchasedOnly && !item.purchasedAt) return false
      if (!includePurchased && !purchasedOnly && item.purchasedAt) return false
      if (tagIds && tagIds.length > 0 && !tagIds.some((tagId) => item.tagIds.includes(tagId))) return false
      return true
    })
    .toArray()
  return excludeItemsInActiveLists(items, await namesInActiveLists(db, groupId))
}

/** 名前の文字コード（UTF-16）の順。照合順序が C の DB の ORDER BY と同じ */
const byCodeUnit = (a: Tag, b: Tag) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

export async function queryTags(
  db: ShoppingMemosDB,
  options: { groupId: string | undefined; order: CatalogOrder }
): Promise<Tag[]> {
  const tags = await db.tags.filter((tag) => tag.groupId === options.groupId).toArray()
  return options.order === "server" ? tags.sort(byCodeUnit) : tags
}
