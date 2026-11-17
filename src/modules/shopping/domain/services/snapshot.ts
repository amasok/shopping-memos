import type { CreateListItemInput } from "../entities/ListItem"

/** スナップショットの元になるカタログの商品 */
export interface SnapshotSource {
  name: string
  quantity: number
  memo: string | null | undefined
  tagIds: readonly string[]
}

/**
 * カタログの商品から、リストの商品の写しを作る（#179。specs/shopping「リストの商品のスナップショット」）
 * - 名前・数量・メモ・タグを写す（チェックは付けない。作成時の既定は未チェック）
 * - groupId はリストの groupId にする（#68。リストの中で groupId をそろえる）
 */
export function snapshotListItem(
  source: SnapshotSource,
  list: { id: string; groupId: string | null | undefined },
  id: string
): CreateListItemInput & { memo: string | null; tagIds: string[]; groupId: string | null } {
  return {
    id,
    listId: list.id,
    name: source.name,
    quantity: source.quantity,
    memo: source.memo ?? null,
    tagIds: [...source.tagIds],
    groupId: list.groupId ?? null,
  }
}
