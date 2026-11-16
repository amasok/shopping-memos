/**
 * 入力の長さ・数量の上限。サーバーのスキーマ（item / tag / list / sync）と UI（maxLength・数量ボタン）、
 * ゲストデータの送信前の整形で共有する。値を変えるときはここだけを直す
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
