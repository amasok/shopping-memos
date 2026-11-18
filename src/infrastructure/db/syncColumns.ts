import { isNull, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"

/**
 * 同期用の列（updated_at / field_modified_at / deleted_at）の書き込み（#62 O3b）
 *
 * docs/features/offline-support.md「## 実装方針」のとおり:
 * - updated_at はサーバーの書き込み時刻（pull のカーソル専用）。DB の now() だけで入れ、JS の Date と混ぜない
 * - field_modified_at はフィールド名 → 最後に書き込んだ時刻（LWW の判定専用）。通常の mutation でも、
 *   書き込んだフィールドのキーをサーバー時刻で更新する
 * - deleted_at は論理削除（tombstone）の時刻。取得系のクエリは deleted_at IS NULL で絞り込む
 */

/** 同期用の列を持つテーブル（items / tags / shopping_lists / list_items） */
export interface SyncTable {
  updatedAt: AnyPgColumn
  fieldModifiedAt: AnyPgColumn
  deletedAt: AnyPgColumn
}

/**
 * サーバーの現在時刻（DB の now()）を UTC・ミリ秒の ISO 文字列にしたもの（例: 2026-11-17T05:00:00.000Z）。
 * field_modified_at の値はすべてこの形にして、文字列の比較と時刻の比較が一致するようにする
 */
export const SERVER_NOW_ISO: SQL = sql`to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

/** 論理削除されていない行だけにする WHERE 条件 */
export function notDeleted(table: SyncTable): SQL {
  return isNull(table.deletedAt)
}

/** { field: 時刻, ... } の jsonb（時刻を省くとサーバー時刻） */
function fieldTimesObject(fields: readonly string[], at?: string): SQL {
  const time = at === undefined ? SERVER_NOW_ISO : sql`${at}::text`
  const args = fields.flatMap((field) => [sql`${field}::text`, time])
  return sql`jsonb_build_object(${sql.join(args, sql`, `)})`
}

/**
 * 作成した行の field_modified_at（書き込んだすべてのフィールドにサーバー時刻を入れる）
 */
export function createdFieldTimes(fields: readonly string[]): SQL {
  return fieldTimesObject(fields)
}

/**
 * 通常の mutation で行を更新するときに一緒に入れる値。
 * updated_at を now() にし、field_modified_at の書き込んだフィールドのキーをサーバー時刻にする。
 * at（UTC・ミリ秒の ISO）を渡すと、キーはその時刻にする（sync.push の複合操作の、操作の時刻。#62 O4b）
 */
export function touchFields(
  table: SyncTable,
  fields: readonly string[],
  at?: string
): { updatedAt: SQL; fieldModifiedAt: SQL } {
  return {
    updatedAt: sql`now()`,
    fieldModifiedAt:
      fields.length > 0
        ? sql`${table.fieldModifiedAt} || ${fieldTimesObject(fields, at)}`
        : sql`${table.fieldModifiedAt}`,
  }
}

/** 論理削除するときの値（deleted_at と updated_at を now() にする） */
export function softDeleteValues(): { deletedAt: SQL; updatedAt: SQL } {
  return { deletedAt: sql`now()`, updatedAt: sql`now()` }
}

/** 値が undefined でないフィールドの名前（部分更新で書き込むフィールド） */
export function definedFields<T extends object>(input: T, fields: readonly (keyof T & string)[]): string[] {
  return fields.filter((field) => input[field] !== undefined)
}

/**
 * フィールド単位の LWW の条件: そのフィールドの時刻が at 以前（キーがなければ常に真）。
 * 時刻はすべて UTC・ミリ秒の ISO なので、文字列の比較と時刻の比較が一致する（#62 O4b）
 */
export function fieldNotNewerThan(table: SyncTable, field: string, at: string): SQL {
  return sql`coalesce(${table.fieldModifiedAt} ->> ${field}::text, '') <= ${at}::text`
}
