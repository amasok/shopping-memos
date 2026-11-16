/** リスト詳細の URL。静的ルート（プリキャッシュできる）に ID をクエリで渡す */
export function listDetailHref(listId: string): string {
  return `/lists/detail?id=${encodeURIComponent(listId)}`
}
