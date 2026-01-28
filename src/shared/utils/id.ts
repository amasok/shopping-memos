/**
 * UUID v4を生成する
 * ブラウザとNode.js両方で動作
 */
export function generateId(): string {
  return crypto.randomUUID()
}
