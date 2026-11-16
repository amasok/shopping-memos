import { and, eq, isNull, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import type { DrizzleDB } from "./drizzle/client"
import { groupMembers } from "./drizzle/schema"

/**
 * データの所有スコープの判定（#101）
 *
 * アプリのデータ（アイテム・タグ・リスト）は、次のどちらかに属する。
 * - groupId あり: グループのデータ（グループのメンバーだけが使える）
 * - groupId なし: userId（作成者）の個人データ（作成者だけが使える）
 * 所有者が特定できない（groupId も userId もない）データは、だれのものでもない（どのスコープとも一致しない）。
 *
 * この判定は認可の要なので、型と判定をここに 1 つだけ置き、各所はこれを使う。
 * 書き方がファイルごとにずれると（null と undefined の扱いなど）、認可の不備の原因になる。
 * サーバー専用（drizzle を使う）。クライアントから読まれる src/shared には置かない
 */

/** DB の実行コンテキスト（db 本体またはトランザクション） */
export type DbExecutor = DrizzleDB | Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0]

/**
 * データの所有スコープ。groupId は、null と undefined のどちらも「グループなし」として扱う
 */
export interface OwnerScope {
  userId: string | null
  groupId: string | null | undefined
}

/**
 * 2 つのデータが同じ所有スコープに属するか（純粋な判定）
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
