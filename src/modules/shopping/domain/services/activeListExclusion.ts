/**
 * 「買いたいもの」の一覧から、進行中のリストにある商品と同じ名前の商品を除く
 * （#179。specs/shopping「進行中のリストにある商品を「買いたいもの」の一覧から除く」）
 *
 * activeEntryNames には、一覧と同じスコープの、進行中で削除されていないリストの、
 * リストから外していない商品の名前を渡す（どのリストを数えるかは、サーバーでは SQL の条件で絞る）
 */
export function excludeItemsInActiveLists<T extends { name: string }>(
  items: readonly T[],
  activeEntryNames: Iterable<string>
): T[] {
  const names = new Set(activeEntryNames)
  return items.filter((item) => !names.has(item.name))
}
