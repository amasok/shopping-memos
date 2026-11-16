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

/** 文字数の上限に収める */
export function clipText(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

/** 数量を、1〜上限の整数に収める */
export function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(TEXT_LIMITS.quantityMax, Math.max(1, Math.trunc(value)))
}
