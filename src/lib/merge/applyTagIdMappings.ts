type WithTagIds = { tagIds: string[] }

/**
 * サーバーが付け替えたタグの ID（sync.merge の idMappings）を、後から送るチャンクに反映する。
 * 前のリクエストで、ゲストのタグの ID がほかのユーザーのタグと重なって付け替えられた場合に、
 * アイテム・リストアイテムが古い ID（ほかのユーザーのタグ）を指したままにならないようにする
 */
export function applyTagIdMappings<C extends { items: WithTagIds[]; listItems: WithTagIds[] }>(
  chunk: C,
  tagIdMap: ReadonlyMap<string, string>
): C {
  if (tagIdMap.size === 0) return chunk
  const remap = <T extends WithTagIds>(record: T): T =>
    record.tagIds.some((id) => tagIdMap.has(id))
      ? { ...record, tagIds: record.tagIds.map((id) => tagIdMap.get(id) ?? id) }
      : record
  return { ...chunk, items: chunk.items.map(remap), listItems: chunk.listItems.map(remap) }
}
