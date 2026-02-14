/**
 * E2Eテスト用データファクトリ
 * IndexedDB (Dexie) に投入するシードデータを生成
 */

let counter = 0
function nextId(): string {
  counter++
  return `test-${counter}-${Date.now()}`
}

/** テスト間でカウンタをリセット */
export function resetIdCounter(): void {
  counter = 0
}

export function createTag(overrides: Partial<{
  id: string
  name: string
  groupId: string
}> = {}) {
  return {
    id: overrides.id ?? nextId(),
    name: overrides.name ?? `タグ${counter}`,
    groupId: overrides.groupId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function createItem(overrides: Partial<{
  id: string
  name: string
  quantity: number
  memo: string
  tagIds: string[]
  groupId: string
  purchasedAt: string
}> = {}) {
  return {
    id: overrides.id ?? nextId(),
    name: overrides.name ?? `テストアイテム${counter}`,
    quantity: overrides.quantity ?? 1,
    memo: overrides.memo,
    tagIds: overrides.tagIds ?? [],
    groupId: overrides.groupId,
    purchasedAt: overrides.purchasedAt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function createList(overrides: Partial<{
  id: string
  name: string
  status: "in_progress" | "completed"
  groupId: string
  purchasedAt: string
  location: string
}> = {}) {
  return {
    id: overrides.id ?? nextId(),
    name: overrides.name ?? `テストリスト${counter}`,
    status: overrides.status ?? "in_progress",
    groupId: overrides.groupId,
    createdAt: new Date().toISOString(),
    completedAt: overrides.status === "completed" ? new Date().toISOString() : undefined,
    purchasedAt: overrides.purchasedAt,
    location: overrides.location,
  }
}

export function createListItem(overrides: Partial<{
  id: string
  listId: string
  name: string
  quantity: number
  memo: string
  tagIds: string[]
  groupId: string
  checked: boolean
}> = {}) {
  return {
    id: overrides.id ?? nextId(),
    listId: overrides.listId ?? "",
    name: overrides.name ?? `リストアイテム${counter}`,
    quantity: overrides.quantity ?? 1,
    memo: overrides.memo,
    tagIds: overrides.tagIds ?? [],
    groupId: overrides.groupId,
    checked: overrides.checked ?? false,
    createdAt: new Date().toISOString(),
  }
}
