import { and, inArray } from "drizzle-orm"
import { notDeleted } from "@/infrastructure/db/syncColumns"
import { db } from "@/infrastructure/db/drizzle/client"
import { tags } from "@/infrastructure/db/drizzle/schema"
import { isSameScope, type DbExecutor, type OwnerScope } from "@/infrastructure/db/ownership"

// 所有スコープの型と判定は src/infrastructure/db/ownership.ts に 1 つだけ置く（#101）。
// ここからは再エクスポートしない（#151）

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
    .where(and(inArray(tags.id, targetIds), notDeleted(tags)))

  if (found.length !== targetIds.length) {
    return false
  }
  return found.every((tag) => isSameScope(tag, scope))
}
