import { syncRepository } from "@/modules/sync/infrastructure/repositories/DrizzleSyncRepository"
import type {
  Item,
  CreateItemInput,
  UpdateItemInput,
  GetItemsQuery,
  ItemWithTags,
} from "../../domain/entities/Item"
import type {
  Tag,
  CreateTagInput,
  UpdateTagInput,
  GetTagsQuery,
  TagWithUsageCount,
} from "../../domain/entities/Tag"
import type { ItemRepository } from "../../domain/repositories/ItemRepository"
import type { TagRepository } from "../../domain/repositories/TagRepository"

/**
 * Catalog同期サービス
 * CRUD操作と同期ログ記録を統合
 */
export class CatalogSyncService {
  constructor(
    private itemRepository: ItemRepository,
    private tagRepository: TagRepository
  ) {}

  // === アイテム ===

  async createItem(input: CreateItemInput, userId: string): Promise<Item> {
    const item = await this.itemRepository.create(input)

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "item",
      entityId: item.id,
      operation: "create",
      payload: { ...item },
    })

    return item
  }

  async updateItem(input: UpdateItemInput, userId: string): Promise<Item> {
    const item = await this.itemRepository.update(input)

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "item",
      entityId: item.id,
      operation: "update",
      payload: { ...item },
    })

    return item
  }

  async deleteItem(id: string, userId: string): Promise<void> {
    await this.itemRepository.delete(id)

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "item",
      entityId: id,
      operation: "delete",
      payload: { id },
    })
  }

  async markItemAsPurchased(id: string, userId: string): Promise<Item> {
    const item = await this.itemRepository.markAsPurchased(id)

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "item",
      entityId: item.id,
      operation: "update",
      payload: { ...item },
    })

    return item
  }

  async markItemAsUnpurchased(id: string, userId: string): Promise<Item> {
    const item = await this.itemRepository.markAsUnpurchased(id)

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "item",
      entityId: item.id,
      operation: "update",
      payload: { ...item },
    })

    return item
  }

  // 読み取り操作は同期ログ不要
  async getItem(id: string): Promise<ItemWithTags | null> {
    return this.itemRepository.findById(id)
  }

  async getItems(query: GetItemsQuery): Promise<ItemWithTags[]> {
    return this.itemRepository.findMany(query)
  }

  async canAccessItem(itemId: string, userId: string): Promise<boolean> {
    return this.itemRepository.canAccess(itemId, userId)
  }

  // === タグ ===

  async createTag(input: CreateTagInput, userId: string): Promise<Tag> {
    const tag = await this.tagRepository.create(input)

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "tag",
      entityId: tag.id,
      operation: "create",
      payload: { ...tag },
    })

    return tag
  }

  async updateTag(input: UpdateTagInput, userId: string): Promise<Tag> {
    const tag = await this.tagRepository.update(input)

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "tag",
      entityId: tag.id,
      operation: "update",
      payload: { ...tag },
    })

    return tag
  }

  async deleteTag(id: string, userId: string): Promise<void> {
    await this.tagRepository.delete(id)

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "tag",
      entityId: id,
      operation: "delete",
      payload: { id },
    })
  }

  // 読み取り操作は同期ログ不要
  async getTag(id: string): Promise<Tag | null> {
    return this.tagRepository.findById(id)
  }

  async getTags(query: GetTagsQuery): Promise<TagWithUsageCount[]> {
    return this.tagRepository.findMany(query)
  }

  async canAccessTag(tagId: string, userId: string): Promise<boolean> {
    return this.tagRepository.canAccess(tagId, userId)
  }
}
