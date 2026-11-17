import { describe, it, expect, vi, beforeEach } from "vitest"

const createOperation = vi.fn()
vi.mock("@/modules/sync/infrastructure/repositories/DrizzleSyncRepository", () => ({
  syncRepository: { createOperation: (...a: unknown[]) => createOperation(...a) },
}))

import { CatalogSyncService } from "../application/services/CatalogSyncService"

const item = { id: "item-1", name: "牛乳" }
const tag = { id: "tag-1", name: "食品" }

function setup() {
  const itemRepo = {
    create: vi.fn().mockResolvedValue(item),
    update: vi.fn().mockResolvedValue(item),
    delete: vi.fn().mockResolvedValue(undefined),
    markAsPurchased: vi.fn().mockResolvedValue(item),
    markAsUnpurchased: vi.fn().mockResolvedValue(item),
    findById: vi.fn().mockResolvedValue(item),
    findMany: vi.fn().mockResolvedValue([item]),
    canAccess: vi.fn().mockResolvedValue(true),
  }
  const tagRepo = {
    create: vi.fn().mockResolvedValue(tag),
    update: vi.fn().mockResolvedValue(tag),
    delete: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(tag),
    findMany: vi.fn().mockResolvedValue([tag]),
    canAccess: vi.fn().mockResolvedValue(false),
  }
  const service = new CatalogSyncService(itemRepo as never, tagRepo as never)
  return { service, itemRepo, tagRepo }
}

beforeEach(() => {
  createOperation.mockReset()
  createOperation.mockResolvedValue(undefined)
})

describe("CatalogSyncService: 書き込みは同期ログを 1 件残す", () => {
  it.each([
    ["createItem", (s: ReturnType<typeof setup>["service"]) => s.createItem({} as never, "u1"), "item", "create", item],
    ["updateItem", (s: ReturnType<typeof setup>["service"]) => s.updateItem({} as never, "u1"), "item", "update", item],
    ["markItemAsPurchased", (s: ReturnType<typeof setup>["service"]) => s.markItemAsPurchased("item-1", "u1"), "item", "update", item],
    ["markItemAsUnpurchased", (s: ReturnType<typeof setup>["service"]) => s.markItemAsUnpurchased("item-1", "u1"), "item", "update", item],
    ["createTag", (s: ReturnType<typeof setup>["service"]) => s.createTag({} as never, "u1"), "tag", "create", tag],
    ["updateTag", (s: ReturnType<typeof setup>["service"]) => s.updateTag({} as never, "u1"), "tag", "update", tag],
  ])("%s はリポジトリの結果を返し、ペイロード付きでログを記録する", async (_n, run, entity, operation, entityData) => {
    const { service } = setup()
    const result = await run(service)
    expect(result).toEqual(entityData)
    expect(createOperation).toHaveBeenCalledTimes(1)
    expect(createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        entity,
        entityId: entityData.id,
        operation,
        payload: entityData,
        id: expect.any(String),
      })
    )
  })

  it("作成・更新の入力は加工せずリポジトリに渡す", async () => {
    const { service, itemRepo, tagRepo } = setup()
    const itemIn = { id: "i", name: "x" }
    const tagIn = { id: "t", name: "y" }
    await service.createItem(itemIn as never, "u1")
    await service.updateItem(itemIn as never, "u1")
    await service.createTag(tagIn as never, "u1")
    await service.updateTag(tagIn as never, "u1")
    expect(itemRepo.create).toHaveBeenCalledWith(itemIn)
    expect(itemRepo.update).toHaveBeenCalledWith(itemIn)
    expect(tagRepo.create).toHaveBeenCalledWith(tagIn)
    expect(tagRepo.update).toHaveBeenCalledWith(tagIn)
  })

  it("deleteItem は削除してから id だけのペイロードで delete を記録する", async () => {
    const { service, itemRepo } = setup()
    await service.deleteItem("item-1", "u1")
    expect(itemRepo.delete).toHaveBeenCalledWith("item-1")
    expect(itemRepo.delete.mock.invocationCallOrder[0]).toBeLessThan(createOperation.mock.invocationCallOrder[0])
    expect(createOperation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "item", entityId: "item-1", operation: "delete", payload: { id: "item-1" } })
    )
  })

  it("deleteTag は削除してから id だけのペイロードで delete を記録する", async () => {
    const { service, tagRepo } = setup()
    await service.deleteTag("tag-1", "u1")
    expect(tagRepo.delete).toHaveBeenCalledWith("tag-1")
    expect(tagRepo.delete.mock.invocationCallOrder[0]).toBeLessThan(createOperation.mock.invocationCallOrder[0])
    expect(createOperation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "tag", entityId: "tag-1", operation: "delete", payload: { id: "tag-1" } })
    )
  })

  it("リポジトリが失敗したら同期ログは記録しない", async () => {
    const { service, itemRepo } = setup()
    itemRepo.create.mockRejectedValue(new Error("db down"))
    await expect(service.createItem({} as never, "u1")).rejects.toThrow("db down")
    expect(createOperation).not.toHaveBeenCalled()
  })
})

describe("CatalogSyncService: 読み取りは同期ログを残さない", () => {
  it("取得系はリポジトリの結果をそのまま返す", async () => {
    const { service, itemRepo, tagRepo } = setup()
    expect(await service.getItem("item-1")).toEqual(item)
    expect(await service.getItems({ userId: "u1" } as never)).toEqual([item])
    expect(await service.getTag("tag-1")).toEqual(tag)
    expect(await service.getTags({ userId: "u1" } as never)).toEqual([tag])
    expect(itemRepo.findMany).toHaveBeenCalledWith({ userId: "u1" })
    expect(tagRepo.findMany).toHaveBeenCalledWith({ userId: "u1" })
    expect(createOperation).not.toHaveBeenCalled()
  })

  it("アクセス可否はリポジトリの判定をそのまま返す", async () => {
    const { service } = setup()
    expect(await service.canAccessItem("item-1", "u1")).toBe(true)
    expect(await service.canAccessTag("tag-1", "u1")).toBe(false)
  })
})
