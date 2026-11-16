import { inArray } from "drizzle-orm"
import { db, type DrizzleDB } from "@/infrastructure/db/drizzle/client"
import { tags } from "@/infrastructure/db/drizzle/schema"

/**
 * DB実行コンテキスト（db 本体またはトランザクション）
 */
export type DbExecutor = DrizzleDB | Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0]

/**
 * データの所有スコープ
 * - groupId あり: グループのデータ
 * - groupId なし: userId（作成者）の個人データ
 */
export interface OwnerScope {
  userId: string | null
  groupId: string | null | undefined
}

/**
 * 2つのデータが同じ所有スコープに属するか判定する
 * - グループデータ同士: groupId が一致
 * - 個人データ同士: userId が一致
 * - 所有者が特定できないデータはどのスコープとも一致しない
 */
export function isSameScope(a: OwnerScope, b: OwnerScope): boolean {
  const aGroup = a.groupId ?? null
  const bGroup = b.groupId ?? null
  if (aGroup || bGroup) {
    return aGroup === bGroup
  }
  return a.userId !== null && a.userId === b.userId
}

/**
 * 指定したタグがすべて存在し、かつ scope と同じ所有スコープに属するか判定する
 * @param allowedTagIds スコープ判定を省略してよいタグID（同一処理内で作成したタグなど）
 */
export async function areTagsInScope(
  tagIds: readonly string[] | undefined,
  scope: OwnerScope,
  options: { executor?: DbExecutor; allowedTagIds?: ReadonlySet<string> } = {}
): Promise<boolean> {
  const { executor = db, allowedTagIds } = options
  const targetIds = [...new Set(tagIds ?? [])].filter((id) => !allowedTagIds?.has(id))
  if (targetIds.length === 0) {
    return true
  }

  const found = await executor
    .select({ id: tags.id, userId: tags.userId, groupId: tags.groupId })
    .from(tags)
    .where(inArray(tags.id, targetIds))

  if (found.length !== targetIds.length) {
    return false
  }
  return found.every((tag) => isSameScope(tag, scope))
}
