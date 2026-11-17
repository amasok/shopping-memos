import type { ListItem, ShoppingItem, ShoppingList } from "@/lib/db"
import { enqueue } from "./syncQueue"
import { createRecord, deleteRecord, updateRecord, type LocalStore } from "./repository"
import { createItem } from "./catalogRepository"
import { planFinishShopping } from "@/modules/shopping/domain/services/finishShopping"
import { planRevertHistory } from "@/modules/shopping/domain/services/revertHistory"
import { selectItemsToPurchase, selectItemsToUnpurchase, type CatalogCandidate } from "@/modules/shopping/domain/services/catalogMatch"
import { snapshotListItem } from "@/modules/shopping/domain/services/snapshot"
import type { ListStateValues } from "@/modules/shopping/domain/services/listState"

/**
 * 買い物（リスト・リストの商品・履歴）の端末の DB のリポジトリ（#62 O8。openspec の shopping の「端末の DB の…」）
 *
 * ゲスト（queue: false）とローカルファースト（queue: true）の両方がここを通る。どの操作も lists・listItems・items・syncQueue の
 * 1 トランザクションで行う。完了と取り消しは #179 の domain の関数で端末の DB を更新し、キューには複合操作だけを積む（design.md D3）
 */

/** 完了の規則。ゲストは 179b が決まるまで今の振る舞いを残す（design.md D4） */
export type FinishRules = "server" | "guest"

/**
 * 端末の DB の照合で、候補とリストの両方に入れる固定の所有者（design.md D3）。
 * 端末の DB には自分のスコープの行だけがあるので、スコープは groupId が同じことと同じ。ローカルで作った商品は userId を持たない
 */
const LOCAL_OWNER = "local"

export interface CreateListInput {
  name: string
  groupId?: string | null
  itemIds?: string[]
  tagIds?: string[]
}

export interface AddNewItemToListInput {
  listId: string
  name: string
  quantity?: number
  memo?: string | null
  tagIds?: string[]
}

function tables(store: LocalStore) {
  const { db } = store
  return [db.lists, db.listItems, db.items, db.syncQueue]
}

async function getList(store: LocalStore, listId: string): Promise<ShoppingList> {
  const list = await store.db.lists.get(listId)
  if (!list) throw new Error("リストが見つかりません")
  return list
}

/** 進行中のリストだけに、商品を入れる・外す・チェックできる（sync.push の list_completed と同じ） */
async function getOpenList(store: LocalStore, listId: string): Promise<ShoppingList> {
  const list = await getList(store, listId)
  if (list.status !== "in_progress") throw new Error("完了したリストは変更できません")
  return list
}

/** スナップショットからリストの商品を作る（キューのパッチは sync.push の listItem の create） */
async function addSnapshot(store: LocalStore, list: ShoppingList, item: Pick<ShoppingItem, "name" | "quantity" | "memo" | "tagIds">) {
  const snap = snapshotListItem(
    { name: item.name, quantity: item.quantity, memo: item.memo, tagIds: item.tagIds },
    { id: list.id, groupId: list.groupId },
    crypto.randomUUID()
  )
  const now = store.clock.now()
  const record: Omit<ListItem, "updatedAt"> = {
    id: snap.id,
    listId: snap.listId,
    name: snap.name,
    quantity: snap.quantity,
    memo: snap.memo ?? undefined,
    tagIds: snap.tagIds,
    groupId: snap.groupId ?? undefined,
    checked: false,
    createdAt: now,
  }
  const patch: Record<string, unknown> = {
    listId: snap.listId,
    name: snap.name,
    quantity: snap.quantity,
    tagIds: snap.tagIds,
    checked: false,
  }
  if (snap.memo !== null) patch.memo = snap.memo
  return createRecord<ListItem>(store, "listItems", record, patch)
}

export async function createList(store: LocalStore, input: CreateListInput): Promise<ShoppingList> {
  return store.db.transaction("rw", tables(store), async () => {
    const now = store.clock.now()
    const groupId = input.groupId ?? undefined
    const patch: Record<string, unknown> = { name: input.name }
    if (groupId) patch.groupId = groupId
    const list = await createRecord<ShoppingList>(
      store,
      "lists",
      { id: crypto.randomUUID(), name: input.name, status: "in_progress", groupId, createdAt: now },
      patch
    )

    // 選んだ商品（端末にないものは飛ばし、グループが違えば断る。サーバーの createList と同じ）
    for (const itemId of input.itemIds ?? []) {
      const item = await store.db.items.get(itemId)
      if (!item) continue
      if (item.groupId !== groupId) throw new Error("このアイテムをリストに追加する権限がありません")
      await addSnapshot(store, list, item)
    }

    // タグで選ぶ商品（同じグループ・未購入・どれかのタグ）
    if (input.tagIds && input.tagIds.length > 0) {
      const tagIds = input.tagIds
      const tagged = await store.db.items
        .filter((i) => !i.purchasedAt && i.groupId === groupId && i.tagIds.some((t) => tagIds.includes(t)))
        .toArray()
      for (const item of tagged) await addSnapshot(store, list, item)
    }
    return list
  })
}

export async function updateList(store: LocalStore, input: { id: string; name: string }): Promise<void> {
  await updateRecord<ShoppingList>(store, "lists", input.id, { name: input.name }, { name: input.name })
}

/**
 * リストを消す（リストの商品も消す）
 * 進行中のリストなら、リストの商品ごとの delete も積む（送る前の create を圧縮で一緒に消すため）。
 * 完了したリストでは積まない（サーバーが list_completed で断るため。リストの delete がまとめて消す。design.md D2）
 */
export async function deleteList(store: LocalStore, listId: string): Promise<void> {
  await store.db.transaction("rw", tables(store), async () => {
    const list = await store.db.lists.get(listId)
    if (!list) return
    const entries = await store.db.listItems.where("listId").equals(listId).toArray()
    if (list.status === "in_progress") {
      for (const entry of entries) await deleteRecord(store, "listItems", entry.id)
    } else {
      await store.db.listItems.bulkDelete(entries.map((e) => e.id))
    }
    await deleteRecord(store, "lists", listId)
  })
}

export async function addItemToList(store: LocalStore, input: { listId: string; itemId: string }): Promise<ListItem> {
  return store.db.transaction("rw", tables(store), async () => {
    const list = await getOpenList(store, input.listId)
    const item = await store.db.items.get(input.itemId)
    if (!item) throw new Error("アイテムが見つかりません")
    if (item.groupId !== list.groupId) throw new Error("このアイテムをリストに追加する権限がありません")
    return addSnapshot(store, list, item)
  })
}

/** 新しい商品をリストに入れる（カタログにも作り、リストから外したときに「買いたいもの」に戻れるようにする） */
export async function addNewItemToList(store: LocalStore, input: AddNewItemToListInput): Promise<ListItem> {
  return store.db.transaction("rw", tables(store), async () => {
    const list = await getOpenList(store, input.listId)
    const item = await createItem(store, {
      name: input.name,
      quantity: input.quantity ?? 1,
      memo: input.memo,
      tagIds: input.tagIds ?? [],
      groupId: list.groupId,
    })
    return addSnapshot(store, list, item)
  })
}

export async function removeItemFromList(store: LocalStore, listItemId: string): Promise<void> {
  await store.db.transaction("rw", tables(store), async () => {
    const entry = await store.db.listItems.get(listItemId)
    if (!entry) return
    await getOpenList(store, entry.listId)
    await deleteRecord(store, "listItems", listItemId)
  })
}

export async function checkItem(store: LocalStore, listItemId: string, checked: boolean): Promise<void> {
  await store.db.transaction("rw", tables(store), async () => {
    const entry = await store.db.listItems.get(listItemId)
    if (!entry) throw new Error("アイテムが見つかりません")
    await getOpenList(store, entry.listId)
    await updateRecord<ListItem>(store, "listItems", listItemId, { checked }, { checked })
  })
}

/** 端末の DB の、リストと同じ groupId のカタログの商品（照合の候補） */
async function candidatesFor(store: LocalStore, list: ShoppingList): Promise<CatalogCandidate[]> {
  const rows = await store.db.items.filter((i) => i.groupId === list.groupId).toArray()
  return rows.map((i) => ({ id: i.id, name: i.name, userId: LOCAL_OWNER, groupId: i.groupId, purchasedAt: i.purchasedAt }))
}

const listScope = (list: ShoppingList) => ({ userId: LOCAL_OWNER, groupId: list.groupId })

/** domain のリストの状態を端末の行にする（端末の DB は null の代わりに undefined を持つ） */
function localListState(state: ListStateValues): Partial<ShoppingList> {
  return {
    status: state.status,
    completedAt: state.completedAt ?? undefined,
    purchasedAt: state.purchasedAt ?? undefined,
    location: state.location ?? undefined,
  }
}

/** リストの状態を書き、updatedAt を更新する（キューには積まない。複合操作が運ぶ） */
async function writeListState(store: LocalStore, listId: string, state: ListStateValues) {
  await store.db.lists.update(listId, { ...localListState(state), updatedAt: store.clock.now() })
}

/**
 * 買い物を完了する（shopping「端末の DB の買い物の完了」「ゲストの買い物の完了」）
 * - server（ローカルファースト）: サーバーと同じ規則。キューに finishShopping（場所だけ）を 1 つ積む
 * - guest: 今の振る舞いを残す（チェック 0 件はエラー、照合は未購入だけ。179b で決める）
 */
export async function finishShopping(
  store: LocalStore,
  listId: string,
  location: string | null | undefined,
  rules: FinishRules
): Promise<{ historyId: string }> {
  await store.db.transaction("rw", tables(store), async () => {
    const list = await getList(store, listId)
    const entries = await store.db.listItems.where("listId").equals(listId).toArray()
    const at = store.clock.now()
    const plan = planFinishShopping({ status: list.status, entries, at, location })
    if (!plan.ok) throw new Error("このリストは既に完了しています")
    if (rules === "guest" && plan.purchaseNames.length === 0) throw new Error("購入済みのアイテムがありません")

    let candidates = await candidatesFor(store, list)
    if (rules === "guest") candidates = candidates.filter((c) => !c.purchasedAt)
    const ids = selectItemsToPurchase(plan.purchaseNames, candidates, listScope(list))
    for (const id of ids) await store.db.items.update(id, { purchasedAt: at, updatedAt: at })

    await store.db.listItems.bulkDelete(plan.removeEntryIds)
    await writeListState(store, listId, plan.listState)
    if (store.queue) {
      const patch = location ? { location } : {}
      await enqueue(store.db, { entity: "list", entityId: listId, type: "finishShopping", patch, clientTime: at.toISOString() })
    }
  })
  return { historyId: listId }
}

/** 履歴を取り消す（shopping「端末の DB の履歴の取り消しと削除」）。キューに revertHistory を 1 つ積む */
export async function revertHistory(store: LocalStore, listId: string): Promise<{ revertedItemIds: string[] }> {
  return store.db.transaction("rw", tables(store), async () => {
    const list = await store.db.lists.get(listId)
    if (!list) throw new Error("履歴が見つかりません")
    const entries = await store.db.listItems.where("listId").equals(listId).toArray()
    const plan = planRevertHistory({ purchasedAt: list.purchasedAt, entries })
    if (!plan.ok) throw new Error("この履歴は既にリストに戻っています")

    const at = store.clock.now()
    const ids = selectItemsToUnpurchase(plan.revertNames, await candidatesFor(store, list), listScope(list))
    for (const id of ids) await store.db.items.update(id, { purchasedAt: undefined, updatedAt: at })
    await writeListState(store, listId, plan.listState)
    if (store.queue) {
      await enqueue(store.db, { entity: "list", entityId: listId, type: "revertHistory", patch: {}, clientTime: at.toISOString() })
    }
    return { revertedItemIds: ids }
  })
}

/**
 * 履歴を消す（リスト・リストの商品・同じ名前と groupId のカタログの商品。今の tRPC の deleteHistory と同じ範囲）
 * キューにはカタログの商品とリストの delete だけを積む（完了したリストの商品の delete はサーバーが断るため）
 */
export async function deleteHistory(store: LocalStore, listId: string): Promise<void> {
  await store.db.transaction("rw", tables(store), async () => {
    const list = await store.db.lists.get(listId)
    if (!list || !list.purchasedAt) throw new Error("履歴が見つかりません")
    const entries = await store.db.listItems.where("listId").equals(listId).toArray()
    const names = new Set(entries.map((e) => e.name))
    const matched = await store.db.items.filter((i) => i.groupId === list.groupId && names.has(i.name)).toArray()
    for (const item of matched) await deleteRecord(store, "items", item.id)
    await deleteList(store, listId)
  })
}
