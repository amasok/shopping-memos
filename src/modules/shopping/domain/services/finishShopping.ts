import { ListStatus, canTransition } from "../value-objects/ListStatus"
import { uniqueNames, type ListStateValues } from "./listState"

/** 完了の計画に使うリストの商品 */
export interface FinishEntry {
  id: string
  name: string
  checked: boolean
}

export type FinishShoppingPlan =
  | {
      ok: true
      /** 完了後のリストの状態 */
      listState: ListStateValues
      /** カタログの商品を購入済みにする名前（チェック済みの商品の名前。重複なし） */
      purchaseNames: string[]
      /** リストから外す商品（未チェック）の ID */
      removeEntryIds: string[]
    }
  | { ok: false; reason: "not_in_progress" | "no_checked_items" }

/**
 * 買い物の完了の計画（#179・179b。specs/shopping「チェック済みの商品がある買い物の完了」「チェック 0 件の完了」）
 *
 * - 進行中のリストだけ完了できる（in_progress → completed の一方通行。canTransition）
 * - チェック済みの商品が 0 件なら完了しない（no_checked_items。画面は確認ダイアログでリストの削除を選ばせる）
 * - チェック済みの商品の名前のカタログの商品を購入済みにし、未チェックの商品をリストから外す
 */
export function planFinishShopping(input: {
  status: string
  entries: readonly FinishEntry[]
  at: Date
  location?: string | null
}): FinishShoppingPlan {
  if (!canTransition(input.status as ListStatus, ListStatus.COMPLETED)) {
    return { ok: false, reason: "not_in_progress" }
  }
  const purchaseNames = uniqueNames(input.entries.filter((e) => e.checked))
  if (purchaseNames.length === 0) {
    return { ok: false, reason: "no_checked_items" }
  }
  return {
    ok: true,
    listState: {
      status: ListStatus.COMPLETED,
      completedAt: input.at,
      purchasedAt: input.at,
      location: input.location ?? null,
    },
    purchaseNames,
    removeEntryIds: input.entries.filter((e) => !e.checked).map((e) => e.id),
  }
}
