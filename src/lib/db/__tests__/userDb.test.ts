// @vitest-environment node
import "fake-indexeddb/auto"
import Dexie from "dexie"
import { afterEach, describe, expect, it, vi } from "vitest"
import { GUEST_DB_NAME, ShoppingMemosDB } from "../index"
import { deleteMeta, getMeta, setMeta } from "../meta"
import { deleteUserDb, getUserDb, userDbName } from "../userDb"
import { attachVersionHandlers, isDbBlocked, subscribeDbBlocked } from "../versionEvents"

const USER = "user-1"

afterEach(async () => {
  await deleteUserDb(USER)
  await deleteUserDb("user-2")
})

describe("ユーザーごとの DB", () => {
  it("ユーザーごとに別の名前の DB を使い、同じユーザーには同じインスタンスを返す", async () => {
    expect(userDbName(USER)).toBe("ShoppingMemosDB-u-user-1")
    expect(getUserDb(USER)).toBe(getUserDb(USER))
    expect(getUserDb(USER).name).not.toBe(GUEST_DB_NAME)

    await getUserDb(USER).tags.add({ id: "t1", name: "野菜", createdAt: new Date(), updatedAt: new Date() })
    expect(await getUserDb("user-2").tags.count()).toBe(0)
  })

  it("ログアウトで DB ごと消える", async () => {
    await getUserDb(USER).tags.add({ id: "t1", name: "野菜", createdAt: new Date(), updatedAt: new Date() })
    await deleteUserDb(USER)
    expect(await Dexie.exists(userDbName(USER))).toBe(false)
    expect(await getUserDb(USER).tags.count()).toBe(0)
  })
})

describe("meta", () => {
  it("カーソル・時計のずれ・最終同期・所属グループを保存して読み出せる", async () => {
    const database = getUserDb(USER)
    expect(await getMeta(database, "cursor")).toBeUndefined()
    await setMeta(database, "cursor", "abc")
    await setMeta(database, "serverTimeOffset", -1200)
    await setMeta(database, "groupIds", ["g1"])
    expect(await getMeta(database, "cursor")).toBe("abc")
    expect(await getMeta(database, "serverTimeOffset")).toBe(-1200)
    expect(await getMeta(database, "groupIds")).toEqual(["g1"])
    await deleteMeta(database, "cursor")
    expect(await getMeta(database, "cursor")).toBeUndefined()
  })
})

describe("v9 → v10 の移行", () => {
  it("以前の形のキューを捨て、リストとリストのアイテムの updatedAt を createdAt で埋める", async () => {
    const name = `upgrade-${crypto.randomUUID()}`
    const old = new Dexie(name)
    old.version(9).stores({
      tags: "id, name, groupId, createdAt",
      items: "id, name, groupId, createdAt, purchasedAt, *tagIds",
      lists: "id, status, groupId, createdAt, purchasedAt",
      listItems: "id, listId, groupId, checked, *tagIds",
      groups: "id, ownerId, inviteCode, createdAt",
      groupMembers: "id, groupId, userId",
      syncQueue: "id, entity, createdAt, retryCount",
      pendingMerge: "key, userId",
    })
    const created = new Date("2026-01-01T00:00:00Z")
    await old.table("lists").add({ id: "l1", name: "週末", status: "in_progress", createdAt: created })
    await old.table("listItems").add({ id: "li1", listId: "l1", name: "牛乳", quantity: 1, tagIds: [], checked: false, createdAt: created })
    await old.table("syncQueue").add({ id: "q1", entity: "item", entityId: "x", operation: "create", payload: "{}", createdAt: created, retryCount: 0 })
    old.close()

    const upgraded = new ShoppingMemosDB(name)
    expect((await upgraded.lists.get("l1"))?.updatedAt).toEqual(created)
    expect((await upgraded.listItems.get("li1"))?.updatedAt).toEqual(created)
    expect(await upgraded.syncQueue.count()).toBe(0)
    expect(await upgraded.meta.count()).toBe(0)
    await upgraded.delete()
  })
})

describe("バージョン更新のイベント", () => {
  it("versionchange を受けたら DB を閉じてリロードする", async () => {
    const name = `vc-${crypto.randomUUID()}`
    const reload = vi.fn()
    const oldTab = new Dexie(name)
    oldTab.version(1).stores({ a: "id" })
    attachVersionHandlers(oldTab, reload)
    await oldTab.open()

    const newTab = new Dexie(name)
    newTab.version(2).stores({ a: "id", b: "id" })
    await newTab.open()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(oldTab.isOpen()).toBe(false)
    await newTab.delete()
  })

  it("古い接続が閉じない間は blocked になり、開けたら戻る", async () => {
    const name = `blocked-${crypto.randomUUID()}`
    const oldTab = new Dexie(name)
    oldTab.version(1).stores({ a: "id" })
    // 古いタブが versionchange で閉じない（ハンドラが付いていない古いコード）
    oldTab.on("versionchange", () => false)
    await oldTab.open()

    const listener = vi.fn()
    const unsubscribe = subscribeDbBlocked(listener)
    const newTab = new Dexie(name)
    newTab.version(2).stores({ a: "id", b: "id" })
    attachVersionHandlers(newTab, vi.fn())
    const opening = newTab.open()

    await vi.waitFor(() => expect(isDbBlocked()).toBe(true))
    oldTab.close()
    await opening
    expect(isDbBlocked()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    await newTab.delete()
  })
})
