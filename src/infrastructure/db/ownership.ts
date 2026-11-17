import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import type { DrizzleDB } from "./drizzle/client"
import { groupMembers } from "./drizzle/schema"
import type { OwnerScope } from "@/shared/domain/ownerScope"

/**
 * データの所有スコープの、DB を使う判定（#101）
 *
 * アプリのデータ（アイテム・タグ・リスト）は、次のどちらかに属する。
 * - groupId あり: グループのデータ（グループのメンバーだけが使える）
 * - groupId なし: userId（作成者）の個人データ（作成者だけが使える）
 * 所有者が特定できない（groupId も userId もない）データは、だれのものでもない（どのスコープとも一致しない）。
 *
 * この判定は認可の要なので、各所はここと共有カーネルの判定を使い、自前で書かない。
 * 書き方がファイルごとにずれると（null と undefined の扱いなど）、認可の不備の原因になる。
 * 型 OwnerScope と純粋な判定 isSameScope は、domain・クライアントからも使えるよう
 * src/shared/domain/ownerScope.ts に置く（#179）。ここは drizzle を使うサーバー専用の判定だけを持つ
 */

/** DB の実行コンテキスト（db 本体またはトランザクション） */
export type DbExecutor = DrizzleDB | Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0]

/** userId と groupId の列を持つテーブル（items / tags / shopping_lists） */
export interface ScopedTable {
  userId: AnyPgColumn
  groupId: AnyPgColumn
}

/**
 * テーブルの行を、指定したスコープのデータに限定する WHERE 条件
 * - グループのスコープ: そのグループのデータ
 * - 個人のスコープ: groupId がなく、userId が一致するデータ
 * - 所有者が特定できないスコープ: 何にも一致しない
 */
export function scopeCondition(table: ScopedTable, scope: OwnerScope): SQL {
  if (scope.groupId) {
    return eq(table.groupId, scope.groupId)
  }
  if (scope.userId) {
    return and(isNull(table.groupId), eq(table.userId, scope.userId)) as SQL
  }
  return sql`false`
}

/**
 * テーブルの行を、ユーザーが使えるデータ（自分の個人データ、または所属しているグループのデータ）に限定する WHERE 条件。
 * 更新・削除の WHERE に付けて、事前の canAccess と書き込みの間に権限が変わっても、他人のデータを書き換えないようにする（#73-1）
 */
export function accessibleByUser(table: ScopedTable, userId: string): SQL {
  return or(
    and(isNull(table.groupId), eq(table.userId, userId)),
    sql`${table.groupId} IN (SELECT ${groupMembers.groupId} FROM ${groupMembers} WHERE ${groupMembers.userId} = ${userId})`
  ) as SQL
}

/**
 * accessibleByUser と同じ範囲を、先に読んだ所属グループの ID で表した WHERE 条件（#62 O5）。
 * サブクエリを使わないので、(user_id, updated_at) と (group_id, updated_at) のインデックスが、両方とも絞り込みに使える
 * （sync.pull のように、所属グループを同じトランザクションで先に読む読み取り用）
 */
export function ownedOrInGroups(table: ScopedTable, userId: string, groupIds: readonly string[]): SQL {
  const personal = and(isNull(table.groupId), eq(table.userId, userId)) as SQL
  return groupIds.length > 0 ? (or(personal, inArray(table.groupId, [...groupIds])) as SQL) : personal
}

/**
 * ユーザーがそのスコープのデータを使えるか（DB を使う判定）
 * - 個人データ: 作成者本人だけ（所有者が分からないデータは、だれも使えない）
 * - グループのデータ: グループのメンバーだけ
 */
export async function canAccessScope(
  executor: DbExecutor,
  scope: OwnerScope,
  userId: string
): Promise<boolean> {
  if (!scope.groupId) {
    return scope.userId !== null && scope.userId === userId
  }

  const membership = await executor
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, scope.groupId), eq(groupMembers.userId, userId)))
    .limit(1)

  return membership.length > 0
}
