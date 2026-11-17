import { isSameScope, type OwnerScope } from "@/shared/domain/ownerScope"
import type { DateValue } from "./listState"

/** 照合の候補になるカタログの商品 */
export interface CatalogCandidate extends OwnerScope {
  id: string
  name: string
  purchasedAt: DateValue
  /** 論理削除の日時（あれば照合しない） */
  deletedAt?: DateValue
}

/**
 * リストの商品の名前と、同じ名前・同じスコープの、論理削除されていないカタログの商品を照合する
 * （specs/shopping「所有スコープの照合」）
 */
function matchByNameInScope(
  names: readonly string[],
  candidates: readonly CatalogCandidate[],
  listScope: OwnerScope
): CatalogCandidate[] {
  const wanted = new Set(names)
  return candidates.filter(
    (c) => wanted.has(c.name) && !c.deletedAt && isSameScope(c, listScope)
  )
}

/**
 * 買い物の完了で購入済みにするカタログの商品の ID
 * 購入状態は見ない（同じ名前の購入済みの商品も購入日時を更新する。今のサーバーの振る舞い。変えるのは 179b）
 */
export function selectItemsToPurchase(
  names: readonly string[],
  candidates: readonly CatalogCandidate[],
  listScope: OwnerScope
): string[] {
  return matchByNameInScope(names, candidates, listScope).map((c) => c.id)
}

/** 履歴の取り消しで未購入に戻すカタログの商品の ID（購入済みのものだけ） */
export function selectItemsToUnpurchase(
  names: readonly string[],
  candidates: readonly CatalogCandidate[],
  listScope: OwnerScope
): string[] {
  return matchByNameInScope(names, candidates, listScope)
    .filter((c) => c.purchasedAt !== null && c.purchasedAt !== undefined)
    .map((c) => c.id)
}
