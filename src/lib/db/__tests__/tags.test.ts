// @vitest-environment node
import "fake-indexeddb/auto"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { db } from "../index"
import {
  DEFAULT_TAG_NAMES,
  createTag,
  deleteTag,
  getTagById,
  getTags,
  getTagsByGroupId,
  getTagsByIds,
  initializeDefaultTags,
  updateTag,
} from "../tags"

const NOW = new Date("2026-03-01T09:00:00Z")

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe("ゲストのタグ（Dexie）", () => {
  it("作成したタグを ID で取得できる", async () => {
    const tag = await createTag("野菜")
    expect(await getTagById(tag.id)).toMatchObject({ name: "野菜" })
  })

  it("存在しない ID は undefined を返す", async () => {
    expect(await getTagById("nope")).toBeUndefined()
  })

  it("作成順に並べて返す", async () => {
    await db.tags.add({ id: "b", name: "後", createdAt: new Date("2026-03-02"), updatedAt: NOW })
    await db.tags.add({ id: "a", name: "先", createdAt: new Date("2026-03-01"), updatedAt: NOW })
    expect((await getTags()).map((t) => t.id)).toEqual(["a", "b"])
  })

  it("複数の ID でまとめて取得できる", async () => {
    const a = await createTag("A")
    await createTag("B")
    const c = await createTag("C")
    expect((await getTagsByIds([a.id, c.id])).map((t) => t.name).sort()).toEqual(["A", "C"])
  })

  it("groupId を指定するとそのグループのタグだけ、未指定なら個人タグだけを返す", async () => {
    await createTag("個人")
    await createTag("家族", "g1")
    await createTag("他", "g2")
    expect((await getTagsByGroupId("g1")).map((t) => t.name)).toEqual(["家族"])
    expect((await getTagsByGroupId(undefined)).map((t) => t.name)).toEqual(["個人"])
  })

  it("名前を更新すると updatedAt も進む", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-03-01T09:00:00Z"))
    const tag = await createTag("旧")
    vi.setSystemTime(new Date("2026-03-01T09:00:05Z"))
    await updateTag(tag.id, "新")
    const after = await getTagById(tag.id)
    expect(after?.name).toBe("新")
    expect(after!.updatedAt.getTime()).toBeGreaterThan(tag.updatedAt.getTime())
  })

  it("タグを削除すると、アイテムの tagIds からも外れる", async () => {
    const tag = await createTag("消す")
    await db.items.add({ id: "i1", name: "牛乳", quantity: 1, tagIds: [tag.id, "keep"], createdAt: NOW, updatedAt: NOW } as never)
    await deleteTag(tag.id)
    expect(await getTagById(tag.id)).toBeUndefined()
    expect((await db.items.get("i1"))?.tagIds).toEqual(["keep"])
  })

  it("タグが 1 件もないときだけ初期タグを作る", async () => {
    await initializeDefaultTags()
    expect((await getTags()).map((t) => t.name).sort()).toEqual([...DEFAULT_TAG_NAMES].sort())
    await initializeDefaultTags()
    expect(await db.tags.count()).toBe(DEFAULT_TAG_NAMES.length)
  })

  it("すでにタグがあれば初期タグを足さない", async () => {
    await createTag("自分のタグ")
    await initializeDefaultTags()
    expect(await db.tags.count()).toBe(1)
  })
})
