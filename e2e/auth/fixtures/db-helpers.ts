import { type Page } from "@playwright/test"
import { randomUUID } from "crypto"

const SEED_API_URL = "http://localhost:3000/api/e2e/seed"

/**
 * E2Eテスト用DB操作ヘルパー
 * /api/e2e/seed エンドポイント経由でサーバーDBを操作
 */

/** テスト用UUID生成 */
export function testUUID(): string {
  return randomUUID()
}

/** @e2e-test.local ユーザーの関連データをすべて削除 */
export async function cleanupE2EData(): Promise<void> {
  const res = await fetch(SEED_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cleanup" }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`cleanup failed: ${res.status} ${body}`)
  }
}

/** グループと関連データのみ削除（ユーザーは残す） */
export async function cleanupGroups(): Promise<void> {
  const res = await fetch(SEED_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cleanup-groups" }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`cleanup-groups failed: ${res.status} ${body}`)
  }
}

/** グループを作成（オーナー付き） */
export async function seedGroup(data: {
  groupId: string
  groupName: string
  ownerUserId: string
  inviteCode: string
  inviteEnabled?: boolean
  /** ISO 文字列。省略時は DB の既定値（7 日後） */
  inviteCodeExpiresAt?: string
}): Promise<void> {
  const res = await fetch(SEED_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "seed-group", data }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`seed-group failed: ${res.status} ${body}`)
  }
}

/** グループにメンバーを追加 */
export async function addGroupMember(data: {
  groupId: string
  userId: string
}): Promise<void> {
  const res = await fetch(SEED_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "add-group-member", data }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`add-group-member failed: ${res.status} ${body}`)
  }
}

/** アイテムを作成 */
export async function seedItems(data: {
  userId: string
  groupId?: string
  items: Array<{ id: string; name: string; quantity?: number; memo?: string }>
}): Promise<void> {
  const res = await fetch(SEED_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "seed-items", data }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`seed-items failed: ${res.status} ${body}`)
  }
}

/** メールアドレスからユーザー情報を取得 */
export async function getUser(email: string): Promise<{ id: string; name: string; email: string }> {
  const res = await fetch(SEED_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "get-user", data: { email } }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`get-user failed: ${res.status} ${body}`)
  }
  const json = await res.json()
  return json.user
}

/** DataMergeをスキップするためのlocalStorage設定 */
export async function skipDataMerge(page: Page, userId: string): Promise<void> {
  await page.evaluate((uid) => {
    localStorage.setItem(`data-merge-completed-${uid}`, "true")
  }, userId)
}
