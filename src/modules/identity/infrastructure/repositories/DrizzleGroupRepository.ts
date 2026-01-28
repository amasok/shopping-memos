import { eq, and } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import {
  groups,
  groupMembers,
  inviteLinks,
  users,
} from "@/infrastructure/db/drizzle/schema"
import type { GroupRepository } from "../../domain/repositories/GroupRepository"
import type { Group, CreateGroupInput, UpdateGroupInput } from "../../domain/entities/Group"
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
    const now = new Date()

    // トランザクションでグループとオーナーを同時作成
    const [group] = await db.insert(groups).values({
      id: input.id,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    }).returning()

    // オーナーとして追加
    await db.insert(groupMembers).values({
      id: crypto.randomUUID(),
      groupId: input.id,
      userId: input.ownerId,
      role: "owner",
      joinedAt: now,
    })

    return group
  }

  async findById(id: string): Promise<Group | null> {
    const result = await db.select().from(groups).where(eq(groups.id, id))
    return result[0] ?? null
  }

  async findByUserId(userId: string): Promise<Group[]> {
    const result = await db
      .select({
        id: groups.id,
        name: groups.name,
        createdAt: groups.createdAt,
        updatedAt: groups.updatedAt,
      })
      .from(groups)
      .innerJoin(groupMembers, eq(groups.id, groupMembers.groupId))
      .where(eq(groupMembers.userId, userId))

    return result
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

  async markInviteAsUsed(id: string, userId: string): Promise<void> {
    await db
      .update(inviteLinks)
      .set({
        usedAt: new Date(),
        usedBy: userId,
      })
      .where(eq(inviteLinks.id, id))
  }
}

// シングルトンインスタンス
export const groupRepository = new DrizzleGroupRepository()
