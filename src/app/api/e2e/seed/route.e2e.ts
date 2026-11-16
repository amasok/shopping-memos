import { NextResponse } from "next/server"
import { db } from "@/infrastructure/db/drizzle/client"
import {
  users,
  groups,
  groupMembers,
  items,
  tags,
  itemTags,
  shoppingLists,
  listItems,
} from "@/infrastructure/db/drizzle/schema"
import { and, eq, like, inArray } from "drizzle-orm"
import { z } from "zod"
import {
  E2E_EMAIL_DOMAIN,
  isE2EEmail,
  isE2ERequestAllowed,
} from "@/lib/e2e/guard"

/**
 * E2Eテスト用シード/クリーンアップAPI（#70）
 *
 * - ビルド時: ファイル名が `route.e2e.ts` なので、`E2E_BUILD=true` のビルドにだけ含まれる
 * - 実行時: `E2E_TEST`・`VERCEL_ENV`・`x-e2e-token` の条件がそろわなければ 404
 * - 操作できるのは `@e2e-test.local` のユーザーと、そのユーザーがオーナーのグループだけ
 */

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 })
const badRequest = () => NextResponse.json({ error: "Bad request" }, { status: 400 })
const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 })

const id = z.string().min(1).max(100)

const seedGroupSchema = z.object({
  groupId: id,
  groupName: z.string().min(1).max(100),
  ownerUserId: id,
  inviteCode: z.string().min(1).max(100),
  inviteEnabled: z.boolean().optional(),
  /** ISO 文字列。省略時は DB の既定値（7 日後） */
  inviteCodeExpiresAt: z.iso.datetime().optional(),
})

const addGroupMemberSchema = z.object({ groupId: id, userId: id })

const seedItemsSchema = z.object({
  userId: id,
  groupId: id.optional(),
  items: z
    .array(
      z.object({
        id,
        name: z.string().min(1).max(100),
        quantity: z.number().int().optional(),
        memo: z.string().max(1000).optional(),
      })
    )
    .max(100),
})

const getUserSchema = z.object({ email: z.string().max(254) })

/** E2E 用ドメインのユーザーか */
async function isE2EUserId(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
  return isE2EEmail(user?.email)
}

/**
 * 指定したグループのうち、オーナーが全員 E2E 用ドメインのユーザーであるものだけを返す。
 * E2E ユーザーが参加しているだけの、ほかのユーザーのグループは含めない
 */
async function filterE2EGroupIds(groupIds: string[]): Promise<string[]> {
  if (groupIds.length === 0) return []
  const owners = await db
    .select({ groupId: groupMembers.groupId, email: users.email })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(and(inArray(groupMembers.groupId, groupIds), eq(groupMembers.role, "owner")))
  const allE2E = new Map<string, boolean>()
  for (const o of owners) {
    allE2E.set(o.groupId, (allE2E.get(o.groupId) ?? true) && isE2EEmail(o.email))
  }
  return groupIds.filter((id) => allE2E.get(id) === true)
}

/** オーナーが E2E 用ドメインのユーザーであるグループか */
async function isE2EGroup(groupId: string): Promise<boolean> {
  return (await filterE2EGroupIds([groupId])).length === 1
}

export async function POST(request: Request) {
  if (!isE2ERequestAllowed(request)) return notFound()

  let action: unknown
  let data: unknown
  try {
    const body = await request.json()
    action = body?.action
    data = body?.data
  } catch {
    return badRequest()
  }

  try {
    switch (action) {
      case "cleanup": {
        // @e2e-test.local ドメインのユーザーに紐づくデータを削除
        const e2eUsers = await db
          .select({ id: users.id })
          .from(users)
          .where(like(users.email, `%${E2E_EMAIL_DOMAIN}`))

        const userIds = e2eUsers.map((u) => u.id)

        if (userIds.length > 0) {
          // グループメンバーからe2eユーザーが所属するグループIDを取得
          const memberRecords = await db
            .select({ groupId: groupMembers.groupId })
            .from(groupMembers)
            .where(inArray(groupMembers.userId, userIds))
          // 消すのは E2E ユーザーがオーナーのグループだけ。ほかのグループでの
          // メンバーシップは、ユーザーの削除（cascade）で消える
          const groupIds = await filterE2EGroupIds([
            ...new Set(memberRecords.map((m) => m.groupId)),
          ])

          // リスト → リストアイテム → アイテム → タグ → グループメンバー → グループ → ユーザー の順で削除
          if (groupIds.length > 0) {
            // リストアイテム削除 (listのuserIdベース)
            const listsToDelete = await db
              .select({ id: shoppingLists.id })
              .from(shoppingLists)
              .where(inArray(shoppingLists.userId, userIds))
            const listIds = listsToDelete.map((l) => l.id)
            if (listIds.length > 0) {
              await db
                .delete(listItems)
                .where(inArray(listItems.listId, listIds))
            }
            await db
              .delete(shoppingLists)
              .where(inArray(shoppingLists.userId, userIds))

            // アイテムタグ削除
            const itemsToDelete = await db
              .select({ id: items.id })
              .from(items)
              .where(inArray(items.userId, userIds))
            const itemIds = itemsToDelete.map((i) => i.id)
            if (itemIds.length > 0) {
              await db
                .delete(itemTags)
                .where(inArray(itemTags.itemId, itemIds))
            }
            await db.delete(items).where(inArray(items.userId, userIds))
            await db.delete(tags).where(inArray(tags.userId, userIds))

            // グループメンバー削除
            await db
              .delete(groupMembers)
              .where(inArray(groupMembers.groupId, groupIds))
            // グループ削除
            await db.delete(groups).where(inArray(groups.id, groupIds))
          } else {
            // グループに属していないe2eユーザーのデータも削除
            const listsToDelete = await db
              .select({ id: shoppingLists.id })
              .from(shoppingLists)
              .where(inArray(shoppingLists.userId, userIds))
            const listIds = listsToDelete.map((l) => l.id)
            if (listIds.length > 0) {
              await db
                .delete(listItems)
                .where(inArray(listItems.listId, listIds))
            }
            await db
              .delete(shoppingLists)
              .where(inArray(shoppingLists.userId, userIds))

            const itemsToDelete = await db
              .select({ id: items.id })
              .from(items)
              .where(inArray(items.userId, userIds))
            const itemIds = itemsToDelete.map((i) => i.id)
            if (itemIds.length > 0) {
              await db
                .delete(itemTags)
                .where(inArray(itemTags.itemId, itemIds))
            }
            await db.delete(items).where(inArray(items.userId, userIds))
            await db.delete(tags).where(inArray(tags.userId, userIds))
          }

          // ユーザー削除 (cascade でaccounts, sessionsも削除される)
          await db.delete(users).where(inArray(users.id, userIds))
        }

        return NextResponse.json({ success: true, deletedUsers: userIds.length })
      }

      case "cleanup-groups": {
        // グループとグループメンバーのみ削除（ユーザーは残す）
        const e2eUsersForGroups = await db
          .select({ id: users.id })
          .from(users)
          .where(like(users.email, `%${E2E_EMAIL_DOMAIN}`))
        const e2eUserIds = e2eUsersForGroups.map((u) => u.id)

        if (e2eUserIds.length > 0) {
          const memberRecs = await db
            .select({ groupId: groupMembers.groupId })
            .from(groupMembers)
            .where(inArray(groupMembers.userId, e2eUserIds))
          // 消すのは E2E ユーザーがオーナーのグループだけ
          const grpIds = await filterE2EGroupIds([
            ...new Set(memberRecs.map((m) => m.groupId)),
          ])
          // ほかのユーザーのグループからは、E2E ユーザーのメンバーシップだけを外す
          await db.delete(groupMembers).where(inArray(groupMembers.userId, e2eUserIds))

          if (grpIds.length > 0) {
            // アイテム（グループ紐付き）削除
            const grpItems = await db
              .select({ id: items.id })
              .from(items)
              .where(inArray(items.groupId, grpIds))
            const grpItemIds = grpItems.map((i) => i.id)
            if (grpItemIds.length > 0) {
              await db.delete(itemTags).where(inArray(itemTags.itemId, grpItemIds))
            }
            await db.delete(items).where(inArray(items.groupId, grpIds))

            // 個人アイテムも削除
            const personalItems = await db
              .select({ id: items.id })
              .from(items)
              .where(inArray(items.userId, e2eUserIds))
            const personalItemIds = personalItems.map((i) => i.id)
            if (personalItemIds.length > 0) {
              await db.delete(itemTags).where(inArray(itemTags.itemId, personalItemIds))
            }
            await db.delete(items).where(inArray(items.userId, e2eUserIds))

            await db.delete(groupMembers).where(inArray(groupMembers.groupId, grpIds))
            await db.delete(groups).where(inArray(groups.id, grpIds))
          } else {
            // グループはないが個人アイテムがあるかも
            const personalItems = await db
              .select({ id: items.id })
              .from(items)
              .where(inArray(items.userId, e2eUserIds))
            const personalItemIds = personalItems.map((i) => i.id)
            if (personalItemIds.length > 0) {
              await db.delete(itemTags).where(inArray(itemTags.itemId, personalItemIds))
              await db.delete(items).where(inArray(items.userId, e2eUserIds))
            }
          }
        }

        return NextResponse.json({ success: true })
      }

      case "seed-group": {
        const parsed = seedGroupSchema.safeParse(data)
        if (!parsed.success) return badRequest()
        const { groupId, groupName, ownerUserId, inviteCode, inviteEnabled, inviteCodeExpiresAt } =
          parsed.data
        if (!(await isE2EUserId(ownerUserId))) return forbidden()

        await db.insert(groups).values({
          id: groupId,
          name: groupName,
          inviteCode,
          inviteEnabled: inviteEnabled ?? true,
          ...(inviteCodeExpiresAt ? { inviteCodeExpiresAt: new Date(inviteCodeExpiresAt) } : {}),
        })

        await db.insert(groupMembers).values({
          id: crypto.randomUUID(),
          groupId,
          userId: ownerUserId,
          role: "owner",
        })

        return NextResponse.json({ success: true, groupId })
      }

      case "add-group-member": {
        const parsed = addGroupMemberSchema.safeParse(data)
        if (!parsed.success) return badRequest()
        const { groupId: memberGroupId, userId: memberUserId } = parsed.data
        if (!(await isE2EUserId(memberUserId)) || !(await isE2EGroup(memberGroupId))) {
          return forbidden()
        }

        await db.insert(groupMembers).values({
          id: crypto.randomUUID(),
          groupId: memberGroupId,
          userId: memberUserId,
          role: "member",
        })

        return NextResponse.json({ success: true })
      }

      case "seed-items": {
        const parsed = seedItemsSchema.safeParse(data)
        if (!parsed.success) return badRequest()
        const { userId: itemUserId, groupId: itemGroupId, items: itemList } = parsed.data
        if (
          !(await isE2EUserId(itemUserId)) ||
          (itemGroupId !== undefined && !(await isE2EGroup(itemGroupId)))
        ) {
          return forbidden()
        }

        for (const item of itemList) {
          await db.insert(items).values({
            id: item.id,
            name: item.name,
            quantity: item.quantity ?? 1,
            memo: item.memo ?? null,
            userId: itemUserId,
            groupId: itemGroupId ?? null,
          })
        }

        return NextResponse.json({ success: true, count: itemList.length })
      }

      case "get-user": {
        const parsed = getUserSchema.safeParse(data)
        if (!parsed.success) return badRequest()
        const email = parsed.data.email.toLowerCase()
        if (!isE2EEmail(email)) return forbidden()
        // テストに必要な列だけを返す
        const [user] = await db
          .select({ id: users.id, email: users.email, name: users.name })
          .from(users)
          .where(eq(users.email, email))
        if (!user) {
          return NextResponse.json({ error: "User not found" }, { status: 404 })
        }
        return NextResponse.json({ user })
      }

      default:
        return badRequest()
    }
  } catch (error) {
    // 詳細はサーバーのログにだけ出し、レスポンスには含めない
    console.error("E2E seed error:", error)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
