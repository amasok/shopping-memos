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
import { eq, like, inArray } from "drizzle-orm"

const E2E_EMAIL_DOMAIN = "@e2e-test.local"

/**
 * E2Eテスト用シード/クリーンアップAPI
 * E2E_TEST=true の場合のみ有効
 */
export async function POST(request: Request) {
  if (process.env.E2E_TEST !== "true") {
    return NextResponse.json({ error: "Not available" }, { status: 404 })
  }

  const body = await request.json()
  const { action, data } = body

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
          const groupIds = [...new Set(memberRecords.map((m) => m.groupId))]

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
          const grpIds = [...new Set(memberRecs.map((m) => m.groupId))]

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
        const { groupId, groupName, ownerUserId, inviteCode, inviteEnabled, inviteCodeExpiresAt } =
          data as {
            groupId: string
            groupName: string
            ownerUserId: string
            inviteCode: string
            inviteEnabled?: boolean
            /** ISO 文字列。省略時は DB の既定値（7 日後） */
            inviteCodeExpiresAt?: string
          }

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
        const { groupId: memberGroupId, userId: memberUserId } = data as {
          groupId: string
          userId: string
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
        const { userId: itemUserId, groupId: itemGroupId, items: itemList } =
          data as {
            userId: string
            groupId?: string
            items: Array<{
              id: string
              name: string
              quantity?: number
              memo?: string
            }>
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

      case "debug-session": {
        // 現在のセッション情報を返す（デバッグ用）
        const { auth } = await import("@/infrastructure/auth")
        const session = await auth()
        return NextResponse.json({
          session,
          hasUser: !!session?.user,
          userId: session?.user?.id ?? null,
        })
      }

      case "get-user": {
        const { email } = data as { email: string }
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
        if (!user) {
          return NextResponse.json({ error: "User not found" }, { status: 404 })
        }
        return NextResponse.json({ user })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error("E2E seed error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
