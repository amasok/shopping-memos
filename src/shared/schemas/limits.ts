import { z } from "zod"

/**
 * 入力の上限（#72）
 *
 * レート制限の主な防御は WAF（#104）に任せ、アプリ側では 1 リクエストで発生させられる
 * DB の処理量とデータの大きさに上限を付ける。値は通常の使い方より十分大きくしてある。
 * push / パッチの値は offline-support.md「#72」（1 リクエスト 100 件、パッチは JSON で 8KB）に合わせる
 */
export const LIMITS = {
  /** アイテム・リストに付けるタグ、絞り込みに使うタグの数 */
  tagIds: 100,
  /** リスト作成時に直接指定するアイテムの数 */
  itemIds: 500,
  /** 数量（DB の integer を超えないように） */
  quantity: 9999,
  /** sync.push の 1 リクエストあたりの操作数 */
  pushOperations: 100,
  /** sync.pull で指定するグループの数 */
  groupIds: 50,
  /** sync のパッチ・merge の 1 レコードの JSON の大きさ（バイト） */
  recordBytes: 8 * 1024,
  /** sync.merge の各配列の件数 */
  merge: {
    items: 1000,
    tags: 200,
    lists: 500,
    listItems: 5000,
    history: 500,
  },
  /** 招待トークンの長さ */
  inviteToken: 200,
  /** tRPC の HTTP バッチ 1 回の呼び出し数 */
  batchSize: 10,
  /** tRPC のリクエストボディの大きさ（バイト） */
  bodyBytes: 2 * 1024 * 1024,
} as const

/** UTF-8 でのバイト数 */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/** JSON にしたときの大きさが上限以内のレコード（sync のパッチ・merge 用） */
export const boundedRecordSchema = z
  .record(z.string(), z.unknown())
  .refine((record) => byteLength(JSON.stringify(record)) <= LIMITS.recordBytes, {
    message: `1 件のデータは ${LIMITS.recordBytes} バイト以内です`,
  })

export const tagIdsSchema = z
  .array(z.string().uuid())
  .max(LIMITS.tagIds, `タグは${LIMITS.tagIds}件までです`)

export const quantitySchema = z
  .number()
  .int()
  .min(1, "数量は1以上です")
  .max(LIMITS.quantity, `数量は${LIMITS.quantity}以下です`)
