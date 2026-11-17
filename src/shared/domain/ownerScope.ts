/**
 * データの所有スコープ（#101・#179）
 *
 * アプリのデータ（アイテム・タグ・リスト）は、グループのデータ（groupId あり）か、
 * 作成者（userId）の個人データ（groupId なし）のどちらかに属する。
 * 所有者が特定できない（groupId も userId もない）データは、どのスコープとも一致しない。
 *
 * 純粋な判定なので、サーバーとクライアント・各コンテキストの domain から使えるよう共有カーネルに置く。
 * DB を使う判定（WHERE 条件・メンバーの確認）は src/infrastructure/db/ownership.ts にある
 */

/** データの所有スコープ。groupId は、null と undefined のどちらも「グループなし」として扱う */
export interface OwnerScope {
  userId: string | null
  groupId: string | null | undefined
}

/**
 * 2 つのデータが同じ所有スコープに属するか
 * - どちらかがグループのデータなら、groupId が一致するときだけ
 * - 個人データ同士なら、userId が一致するときだけ（所有者が分からないデータはどれとも一致しない）
 */
export function isSameScope(a: OwnerScope, b: OwnerScope): boolean {
  const aGroup = a.groupId ?? null
  const bGroup = b.groupId ?? null
  if (aGroup || bGroup) {
    return aGroup === bGroup
  }
  return a.userId !== null && a.userId === b.userId
}
