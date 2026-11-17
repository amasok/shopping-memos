import { z } from "@/shared/schemas/z"
import { TEXT_LIMITS, quantitySchema, tagIdsSchema } from "@/shared/schemas/limits"
import type { SyncPushEntity } from "@/shared/schemas/sync"

/**
 * sync.push のパッチの検証（#62 O4）
 *
 * 受け付けるフィールドは、tRPC の通常のミューテーションと同じ範囲にする（同期 API を抜け道にしない）。
 * 未知のフィールドは拒否する（strict）。フィールド名は API のフィールド名で、field_modified_at のキーと同じ
 */

const timeSchema = z.string().datetime({ offset: true })
const memoSchema = z.string().max(TEXT_LIMITS.memo).nullish()
const name = (max: number) => z.string().min(1).max(max)

const itemCreate = z
  .object({
    name: name(TEXT_LIMITS.itemName),
    quantity: quantitySchema.default(1),
    memo: memoSchema,
    tagIds: tagIdsSchema.default([]),
    purchasedAt: timeSchema.nullish(),
    groupId: z.string().uuid().nullish(),
  })
  .strict()

const itemUpdate = z
  .object({
    name: name(TEXT_LIMITS.itemName).optional(),
    quantity: quantitySchema.optional(),
    memo: memoSchema,
    tagIds: tagIdsSchema.optional(),
    purchasedAt: timeSchema.nullable().optional(),
  })
  .strict()

const tagCreate = z.object({ name: name(TEXT_LIMITS.tagName), groupId: z.string().uuid().nullish() }).strict()
const tagUpdate = z.object({ name: name(TEXT_LIMITS.tagName).optional() }).strict()

const listCreate = z.object({ name: name(TEXT_LIMITS.listName), groupId: z.string().uuid().nullish() }).strict()
const listUpdate = z.object({ name: name(TEXT_LIMITS.listName).optional() }).strict()

const listItemCreate = z
  .object({
    listId: z.string().uuid(),
    name: name(TEXT_LIMITS.listItemName),
    quantity: quantitySchema.default(1),
    memo: memoSchema,
    tagIds: tagIdsSchema.default([]),
    checked: z.boolean().default(false),
  })
  .strict()

const listItemUpdate = z.object({ checked: z.boolean().optional() }).strict()

export type ItemCreatePatch = z.infer<typeof itemCreate>
export type ItemUpdatePatch = z.infer<typeof itemUpdate>
export type TagCreatePatch = z.infer<typeof tagCreate>
export type ListCreatePatch = z.infer<typeof listCreate>
export type ListItemCreatePatch = z.infer<typeof listItemCreate>

export const createPatchSchemas = {
  item: itemCreate,
  tag: tagCreate,
  list: listCreate,
  listItem: listItemCreate,
} as const satisfies Record<SyncPushEntity, z.ZodType>

export const updatePatchSchemas = {
  item: itemUpdate,
  tag: tagUpdate,
  list: listUpdate,
  listItem: listItemUpdate,
} as const satisfies Record<SyncPushEntity, z.ZodType>

/** 更新できるフィールド（作成のパッチのうち、同じ ID の行があったときに更新として扱うもの） */
export function updatableFields(entity: SyncPushEntity): string[] {
  return Object.keys(updatePatchSchemas[entity].shape)
}

/** 作成のときに field_modified_at に記録するフィールド（行の作成で書き込むすべてのフィールド） */
export const CREATED_FIELDS: Record<SyncPushEntity, readonly string[]> = {
  item: ["name", "quantity", "memo", "tagIds", "purchasedAt"],
  tag: ["name"],
  list: ["name", "status", "completedAt", "purchasedAt", "location"],
  listItem: ["name", "quantity", "memo", "tagIds", "checked"],
}
