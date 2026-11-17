import Dexie from "dexie"
import { ShoppingMemosDB } from "./index"

/**
 * ログイン中のユーザーごとの DB（offline-support.md「ローカル DB の分離」）。
 * ゲストの DB（ShoppingMemosDB）とサーバーの複製を混ぜない。ログアウトしたら DB ごと消す
 */

const instances = new Map<string, ShoppingMemosDB>()

export function userDbName(userId: string): string {
  return `ShoppingMemosDB-u-${userId}`
}

/** ユーザーの DB（同じユーザーには同じインスタンスを返す） */
export function getUserDb(userId: string): ShoppingMemosDB {
  let instance = instances.get(userId)
  if (!instance) {
    instance = new ShoppingMemosDB(userDbName(userId))
    instances.set(userId, instance)
  }
  return instance
}

/** ユーザーの DB を消す（ログアウトのとき） */
export async function deleteUserDb(userId: string): Promise<void> {
  instances.get(userId)?.close()
  instances.delete(userId)
  await Dexie.delete(userDbName(userId))
}
