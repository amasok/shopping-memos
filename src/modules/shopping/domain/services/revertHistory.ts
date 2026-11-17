import { ListStatus } from "../value-objects/ListStatus"
import { uniqueNames, type DateValue, type ListStateValues } from "./listState"

/**
 * 購入履歴を取り消せるか: 購入日時が入っているリスト（= 購入履歴）だけ（#179）
 *
 * 取り消しは completed → in_progress に戻すが、「完了の逆」ではなく購入日時の有無で決まる別の操作なので、
 * 一方通行の canTransition（ListStatus.ts）は通さない（design.md D2）
 */
export function canRevert(list: { purchasedAt: DateValue }): boolean {
  return list.purchasedAt !== null && list.purchasedAt !== undefined
}

export type RevertHistoryPlan =
  | {
      ok: true
      /** 取り消し後のリストの状態（進行中・日時と場所なし） */
      listState: ListStateValues
      /** カタログの商品を未購入に戻す名前（リストの商品の名前。重複なし） */
      revertNames: string[]
    }
  | { ok: false; reason: "not_completed" }

/**
 * 履歴の取り消しの計画（#179。specs/shopping「履歴の取り消し」）
 */
export function planRevertHistory(input: {
  purchasedAt: DateValue
  entries: readonly { name: string }[]
}): RevertHistoryPlan {
  if (!canRevert(input)) {
    return { ok: false, reason: "not_completed" }
  }
  return {
    ok: true,
    listState: { status: ListStatus.IN_PROGRESS, completedAt: null, purchasedAt: null, location: null },
    revertNames: uniqueNames(input.entries),
  }
}
