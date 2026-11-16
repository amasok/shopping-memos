import { eq, and, gt, isNull, lt, sql } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import { isUniqueViolation } from "@/infrastructure/db/errors"
import {
  groups,
  groupMembers,
  inviteLinks,
  inviteCodeAttempts,
  users,
} from "@/infrastructure/db/drizzle/schema"
import type { GroupRepository } from "../../domain/repositories/GroupRepository"
import type { Group, GroupWithMemberCount, CreateGroupInput, UpdateGroupInput } from "../../domain/entities/Group"

import {
  generateInviteCode,
  inviteCodeExpiresAt,
  normalizeInviteCode,
} from "../../domain/entities/InviteCode"

/** 試行履歴の保持期間（これより古い履歴は試行時に削除する） */
const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000
/** グループ作成時に、招待コードが重複したら作り直す回数（#73-3） */
const CREATE_GROUP_MAX_ATTEMPTS = 3
import type {
  GroupMember,
  GroupMemberWithUser,
  CreateGroupMemberInput,
} from "../../domain/entities/GroupMember"
import type { InviteLink, CreateInviteLinkInput } from "../../domain/entities/InviteLink"

/**
 * Drizzleを使用したグループリポジトリ実装
 */
export class DrizzleGroupRepository implements GroupRepository {
  // === グループ ===

  async createWithOwner(input: CreateGroupInput): Promise<Group> {
    for (let attempt = 1; ; attempt++) {
      try {
        // グループとオーナーを 1 つのトランザクションで作る（#73-3）。
        // オーナーの追加に失敗したら、オーナーのいないグループを残さない
        return await db.transaction(async (tx) => {
          const now = new Date()
          const [group] = await tx.insert(groups).values({
            id: input.id,
            name: input.name,
            inviteCode: generateInviteCode(),
            inviteCodeExpiresAt: inviteCodeExpiresAt(now),
            createdAt: now,
            updatedAt: now,
          }).returning()

          await tx.insert(groupMembers).values({
            id: crypto.randomUUID(),
            groupId: input.id,
            userId: input.ownerId,
            role: "owner",
            joinedAt: now,
          })

          return group
        })
      } catch (error) {
        // 招待コードがほかのグループと重なったときだけ、コードを作り直して再試行する
        if (attempt < CREATE_GROUP_MAX_ATTEMPTS && isUniqueViolation(error, "invite_code")) continue
        throw error
      }
    }
  }

  async findById(id: string): Promise<Group | null> {
    const result = await db.select().from(groups).where(eq(groups.id, id))
    return result[0] ?? null
  }

  async findByInviteCode(inviteCode: string): Promise<Group | null> {
    const result = await db
      .select()
      .from(groups)
      .where(eq(groups.inviteCode, normalizeInviteCode(inviteCode)))
    return result[0] ?? null
  }

  async findByUserId(userId: string): Promise<GroupWithMemberCount[]> {
    // メンバー数をサブクエリで取得
    const memberCountSubquery = db
      .select({
        groupId: groupMembers.groupId,
        count: sql<number>`count(*)::int`.as("count"),
      })
      .from(groupMembers)
      .groupBy(groupMembers.groupId)
      .as("member_counts")

    const result = await db
      .select({
        id: groups.id,
        name: groups.name,
        inviteCode: groups.inviteCode,
        inviteEnabled: groups.inviteEnabled,
        inviteCodeExpiresAt: groups.inviteCodeExpiresAt,
        createdAt: groups.createdAt,
        updatedAt: groups.updatedAt,
        memberCount: memberCountSubquery.count,
      })
      .from(groups)
      .innerJoin(groupMembers, eq(groups.id, groupMembers.groupId))
      .leftJoin(memberCountSubquery, eq(groups.id, memberCountSubquery.groupId))
      .where(eq(groupMembers.userId, userId))

    return result.map((row) => ({
      ...row,
      memberCount: row.memberCount ?? 0,
    }))
  }

  async update(input: UpdateGroupInput): Promise<Group> {
    const updateData: Partial<typeof groups.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (input.name !== undefined) {
      updateData.name = input.name
    }

    const [updated] = await db
      .update(groups)
      .set(updateData)
      .where(eq(groups.id, input.id))
      .returning()

    return updated
  }

  async delete(id: string): Promise<void> {
    await db.delete(groups).where(eq(groups.id, id))
  }

  async regenerateInviteCode(id: string): Promise<Group> {
    const now = new Date()
    const [updated] = await db
      .update(groups)
      .set({
        inviteCode: generateInviteCode(),
        inviteCodeExpiresAt: inviteCodeExpiresAt(now),
        updatedAt: now,
      })
      .where(eq(groups.id, id))
      .returning()

    return updated
  }

  async setInviteEnabled(id: string, enabled: boolean): Promise<Group> {
    const [updated] = await db
      .update(groups)
      .set({
        inviteEnabled: enabled,
        updatedAt: new Date(),
      })
      .where(eq(groups.id, id))
      .returning()

    return updated
  }

  async recordInviteCodeAttempt(userId: string, windowMs: number): Promise<number> {
    const now = new Date()

    // 先に記録してから数える（同時に送られた試行どうしも互いに数えられる）
    await db.insert(inviteCodeAttempts).values({
      id: crypto.randomUUID(),
      userId,
      attemptedAt: now,
    })

    await db
      .delete(inviteCodeAttempts)
      .where(
        and(
          eq(inviteCodeAttempts.userId, userId),
          lt(inviteCodeAttempts.attemptedAt, new Date(now.getTime() - ATTEMPT_RETENTION_MS))
        )
      )

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inviteCodeAttempts)
      .where(
        and(
          eq(inviteCodeAttempts.userId, userId),
          gt(inviteCodeAttempts.attemptedAt, new Date(now.getTime() - windowMs))
        )
      )

    return row?.count ?? 0
  }

  // === メンバー ===

  async addMember(input: CreateGroupMemberInput): Promise<GroupMember> {
    const [member] = await db.insert(groupMembers).values({
      id: input.id,
      groupId: input.groupId,
      userId: input.userId,
      role: input.role,
      joinedAt: new Date(),
    }).returning()

    return {
      ...member,
      role: member.role as GroupMember["role"],
    }
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
  }

  async findMembers(groupId: string): Promise<GroupMemberWithUser[]> {
    const result = await db
      .select({
        id: groupMembers.id,
        groupId: groupMembers.groupId,
        userId: groupMembers.userId,
        role: groupMembers.role,
        joinedAt: groupMembers.joinedAt,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
        },
      })
      .from(groupMembers)
      .innerJoin(users, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, groupId))

    return result as GroupMemberWithUser[]
  }

  async isMember(groupId: string, userId: string): Promise<boolean> {
    const result = await db
      .select({ id: groupMembers.id })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))

    return result.length > 0
  }

  async isOwner(groupId: string, userId: string): Promise<boolean> {
    const result = await db
      .select({ id: groupMembers.id })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.userId, userId),
          eq(groupMembers.role, "owner")
        )
      )

    return result.length > 0
  }

  // === 招待 ===

  async createInvite(input: CreateInviteLinkInput): Promise<InviteLink> {
    const [invite] = await db.insert(inviteLinks).values({
      id: input.id,
      groupId: input.groupId,
      token: input.token,
      expiresAt: input.expiresAt,
      createdAt: new Date(),
    }).returning()

    return invite
  }

  async findInviteByToken(token: string): Promise<InviteLink | null> {
    const result = await db
      .select()
      .from(inviteLinks)
      .where(eq(inviteLinks.token, token))

    return result[0] ?? null
  }

  /**
   * 招待リンクを使ってメンバーになる（#73-2）。
   * 未使用で期限内のときだけ「使用済み」にして確保し、同じトランザクションでメンバーを追加する。
   * 確保できなければ（同時に別のユーザーが使った、期限切れ）false を返し、何も変えない。
   * メンバーの追加に失敗したら、招待リンクも未使用のまま戻る
   */
  async acceptInvite(input: {
    inviteId: string
    groupId: string
    userId: string
    memberId: string
  }): Promise<boolean> {
    return db.transaction(async (tx) => {
      const now = new Date()
      const claimed = await tx
        .update(inviteLinks)
        .set({ usedAt: now, usedBy: input.userId })
        .where(
          and(
            eq(inviteLinks.id, input.inviteId),
            isNull(inviteLinks.usedAt),
            gt(inviteLinks.expiresAt, now)
          )
        )
        .returning({ id: inviteLinks.id })
      if (claimed.length === 0) return false

      await tx.insert(groupMembers).values({
        id: input.memberId,
        groupId: input.groupId,
        userId: input.userId,
        role: "member",
        joinedAt: now,
      })
      return true
    })
  }
}

// シングルトンインスタンス
export const groupRepository = new DrizzleGroupRepository()
