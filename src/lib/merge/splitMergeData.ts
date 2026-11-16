/**
 * ゲストデータの sync.merge を、件数とボディの大きさの上限に収まるように分ける（#116）
 *
 * - 参照される側を先に送る（タグ → アイテム → リスト → リストアイテム → 履歴）。
 *   サーバーは 1 回のリクエストの中でもこの順に処理するので、前から詰めていけば、
 *   どのレコードも、参照先と同じか、それより後のリクエストで送られる
 * - 1 回のリクエストは、エンティティごとの件数（MERGE_LIMITS）と、JSON の大きさ（maxBytes）の両方に収める
 */

export const MERGE_ENTITY_ORDER = ["tags", "items", "lists", "listItems", "history"] as const

export type MergeEntityKey = (typeof MERGE_ENTITY_ORDER)[number]

export type MergeChunk<T> = Record<MergeEntityKey, T[]>

interface SplitOptions {
  /** エンティティごとの 1 回の件数の上限 */
  limits: Record<MergeEntityKey, number>
  /** 1 回のリクエストの JSON の大きさの上限（バイト。tRPC の入力の外側の分も含めて見積もる） */
  maxBytes: number
}

const encoder = new TextEncoder()
const byteLength = (value: unknown) => encoder.encode(JSON.stringify(value)).length

const emptyChunk = <T>(): MergeChunk<T> => ({
  tags: [],
  items: [],
  lists: [],
  listItems: [],
  history: [],
})

/** 送るデータがあるか */
export function hasMergeData(data: MergeChunk<unknown>): boolean {
  return MERGE_ENTITY_ORDER.some((key) => data[key].length > 0)
}

/** エンティティごとに要素の型が違ってよい（返す各チャンクも同じ型） */
export function splitMergeData<P extends MergeChunk<unknown>>(data: P, { limits, maxBytes }: SplitOptions): P[] {
  // tRPC（superjson）の入力の外側: {"0":{"json":{"data":{...空の配列...}}}} の分
  const envelopeBytes = byteLength({ 0: { json: { data: emptyChunk() } } })

  const chunks: P[] = []
  let current = emptyChunk<unknown>()
  let currentBytes = envelopeBytes
  let currentCount = 0

  const flush = () => {
    if (currentCount === 0) return
    chunks.push(current as P)
    current = emptyChunk<unknown>()
    currentBytes = envelopeBytes
    currentCount = 0
  }

  for (const key of MERGE_ENTITY_ORDER) {
    for (const record of data[key]) {
      // 配列の区切りのカンマの分を 1 バイト足す
      const recordBytes = byteLength(record) + 1
      const overCount = current[key].length >= limits[key]
      const overBytes = currentCount > 0 && currentBytes + recordBytes > maxBytes
      if (overCount || overBytes) flush()
      current[key].push(record)
      currentBytes += recordBytes
      currentCount++
    }
  }
  flush()
  return chunks
}
