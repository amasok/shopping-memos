import { z } from "zod"

/**
 * 入力の上限をここに集める。値を変えるときはここだけを直す
 *
 * - TEXT_LIMITS: 文字数・数量。サーバーのスキーマ（item / tag / list / sync）と UI（maxLength・数量ボタン）、
 *   ゲストデータの送信前の整形で共有する（#86）
 * - MERGE_LIMITS: sync.merge の件数。DataMergeContext の送信前の整形と共有する（#86）
 * - REQUEST_LIMITS: 1 リクエストで発生させられる DB の処理量とデータの大きさ（#72）。
 *   レート制限の主な防御は WAF（#104）に任せる。push とパッチの値は offline-support.md「#72」に合わせる
 */

export const TEXT_LIMITS = {
  itemName: 100,
  listName: 100,
  listItemName: 100,
  tagName: 50,
  location: 100,
  memo: 2000,
  quantityMax: 9999,
} as const

/** マージ入力の上限（巨大なペイロードで DB の容量や処理時間を消費されないようにする） */
export const MERGE_LIMITS = {
  items: 1000,
  tags: 500,
  lists: 500,
  listItems: 1000,
  history: 500,
  tagIdsPerEntity: 50,
} as const

export const REQUEST_LIMITS = {
  /** アイテム・リストに付けるタグ、絞り込みに使うタグの数（merge と同じ値） */
  tagIds: MERGE_LIMITS.tagIdsPerEntity,
  /** リスト作成時に直接指定するアイテムの数 */
  itemIds: 500,
  /** sync.push の 1 リクエストあたりの操作数 */
  pushOperations: 100,
  /** sync.pull で指定するグループの数 */
  groupIds: 50,
  /**
   * sync.push のパッチの JSON の大きさ（バイト）。
   * 最大級のレコード（日本語のメモ 2000 文字・名前 100 文字・タグ 50 件）で約 8.4KB なので、余裕を見て 16KB。
   * merge は要素ごとの検証（未知のキーを取り除く）で足りるので、この上限は使わない
   */
  recordBytes: 16 * 1024,
  /** 招待トークンの長さ */
  inviteToken: 200,
  /**
   * サーバーが受け付ける tRPC の HTTP バッチ 1 回の呼び出し数。
   * クライアント（clientBatchSize）より大きくして、maxItems を持たない古い JS が残っていても 400 にならない余裕を持たせる
   */
  batchSize: 50,
  /** クライアントの httpBatchLink が 1 回にまとめる呼び出し数（maxItems） */
  clientBatchSize: 10,
  /** クライアントの GET のバッチの URL の長さ。超えたら POST に切り替わる（414 を避ける） */
  clientMaxUrlLength: 2000,
  /** tRPC のリクエストボディの大きさ（バイト） */
  bodyBytes: 2 * 1024 * 1024,
  /**
   * sync.merge だけを単独で送るときのボディの大きさ（バイト）。ゲストのデータをまとめて送るため大きくする。
   * Vercel の関数のボディの上限（4.5MB）より少し下にして、アプリ側で 413 として扱う。
   * これを超える量のゲストデータへの根本の対策は、分割送信（#116）
   */
  mergeBodyBytes: 4 * 1024 * 1024,
  /** /api/ogp が受け付ける URL の長さ */
  ogpUrl: 2048,
} as const

/**
 * 文字数の上限に収める。数え方は Zod の `.max()` と同じ UTF-16 の単位。
 * 切る位置がサロゲートペア（絵文字など）の途中なら、1 文字手前で切る
 */
export function clipText(value: string, max: number): string {
  if (value.length <= max) return value
  const lastKept = value.charCodeAt(max - 1)
  const isHighSurrogate = lastKept >= 0xd800 && lastKept <= 0xdbff
  return value.slice(0, isHighSurrogate ? max - 1 : max)
}

/** 数量を、1〜上限の整数に収める */
export function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(TEXT_LIMITS.quantityMax, Math.max(1, Math.trunc(value)))
}

/** JSON にしたときの UTF-8 のバイト数。JSON にできない値（BigInt・循環参照）は上限超えとして扱う */
export function jsonByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** JSON にしたときの大きさが 1 レコードの上限以内か */
export function isWithinRecordBytes(value: unknown): boolean {
  return jsonByteLength(value) <= REQUEST_LIMITS.recordBytes
}

/** JSON にしたときの大きさが上限以内のレコード（sync のパッチ用） */
export const boundedRecordSchema = z
  .record(z.string(), z.unknown())
  .refine(isWithinRecordBytes, {
    message: `1 件のデータは ${REQUEST_LIMITS.recordBytes} バイト以内です`,
  })

export const tagIdsSchema = z
  .array(z.string().uuid())
  .max(REQUEST_LIMITS.tagIds, `タグは${REQUEST_LIMITS.tagIds}件までです`)

export const quantitySchema = z
  .number()
  .int()
  .min(1, "数量は1以上です")
  .max(TEXT_LIMITS.quantityMax, `数量は${TEXT_LIMITS.quantityMax}以下です`)
