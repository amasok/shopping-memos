import { TRPCError } from "@trpc/server"
import { groupRepository } from "@/modules/identity/infrastructure/repositories/DrizzleGroupRepository"

/**
 * グループメンバーシップを検証
 * groupIdが指定されている場合、ユーザーがそのグループのメンバーかどうかを確認
 * @throws TRPCError FORBIDDEN if not a member
 */
export async function verifyGroupMembership(
  groupId: string | null | undefined,
  userId: string
): Promise<void> {
  // groupIdがnullまたはundefinedの場合は検証不要（個人データ）
  if (!groupId) {
    return
  }

  const isMember = await groupRepository.isMember(groupId, userId)
  if (!isMember) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "このグループにアクセスする権限がありません",
    })
  }
}

/**
 * グループオーナーかどうかを検証
 * @throws TRPCError FORBIDDEN if not an owner
 */
export async function verifyGroupOwnership(
  groupId: string,
  userId: string
): Promise<void> {
  const isOwner = await groupRepository.isOwner(groupId, userId)
  if (!isOwner) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "この操作はグループオーナーのみ実行できます",
    })
  }
}
