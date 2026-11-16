import type { GuestDataForMerge, GuestEntity, MergeOutcome } from "@/lib/db/guestData"
import { GUEST_ENTITIES } from "@/lib/db/guestData"
import type { NotImportedRecordRef } from "@/shared/schemas/sync"

/**
 * merge の結果から、ゲストの DB に残すものを決める（#144。offline-support.md「4b」）
 */

type ChunkRecords = {
  tags: Array<{ id: string }>
  items: Array<{ id: string }>
  lists: Array<{ id: string }>
  listItems: Array<{ id: string }>
  history: Array<{ listId: string }>
}

export type FailedIds = Record<GuestEntity, Set<string>>

export const emptyFailedIds = (): FailedIds => ({
  tags: new Set(),
  items: new Set(),
  lists: new Set(),
  listItems: new Set(),
})

/**
 * 1 チャンクの結果から、取り込めなかったレコードの ID を集める
 * - notImported の requestIndex は、そのチャンクの配列での位置
 * - 履歴（history）が取り込めなかったら、そのリストを残す（再送で、履歴だけがもう一度当たる）
 * - notImported を返さない古いサーバーでは、取り込めなかったものが 1 件でもあれば、そのチャンクを全部残す（安全側）
 */
export function collectFailedIds(
  chunk: ChunkRecords,
  result: { notImported?: NotImportedRecordRef[]; notImportedCount: number },
  into: FailedIds
): void {
  if (!result.notImported) {
    if (result.notImportedCount > 0) {
      for (const entity of GUEST_ENTITIES) for (const r of chunk[entity]) into[entity].add(r.id)
      for (const h of chunk.history) into.lists.add(h.listId)
    }
    return
  }
  for (const { entity, requestIndex } of result.notImported) {
    if (entity === "history") {
      const history = chunk.history[requestIndex]
      if (history) into.lists.add(history.listId)
      continue
    }
    const record = chunk[entity][requestIndex]
    if (record) into[entity].add(record.id)
  }
}

/**
 * ゲストの DB への反映内容を決める
 * - 送ったもの: 読んだゲストのデータすべて
 * - 残すもの: 取り込めなかったもの。加えて、残すアイテム・リストアイテムが参照しているタグ（再送のときに参照が切れないように）
 */
export function buildMergeOutcome(guest: GuestDataForMerge, failed: FailedIds): MergeOutcome {
  const keepTags = new Set(failed.tags)
  for (const record of [...guest.items, ...guest.listItems]) {
    if (failed.items.has(record.id) || failed.listItems.has(record.id)) {
      for (const tagId of record.tagIds ?? []) keepTags.add(tagId)
    }
  }
  const tagIds = new Set(guest.tags.map((t) => t.id))
  return {
    sent: {
      tags: guest.tags.map((r) => r.id),
      items: guest.items.map((r) => r.id),
      lists: guest.lists.map((r) => r.id),
      listItems: guest.listItems.map((r) => r.id),
    },
    keep: {
      // 参照しているタグのうち、ゲストの DB にあるものだけ
      tags: [...keepTags].filter((id) => tagIds.has(id)),
      items: [...failed.items],
      lists: [...failed.lists],
      listItems: [...failed.listItems],
    },
    records: guest,
  }
}

/** 残すものがあるか */
export function hasKeptRecords(outcome: MergeOutcome): boolean {
  return GUEST_ENTITIES.some((entity) => outcome.keep[entity].length > 0)
}
