import type { Group, CreateGroupInput, UpdateGroupInput } from "../entities/Group"
import type {
  GroupMember,
  GroupMemberWithUser,
  CreateGroupMemberInput,
} from "../entities/GroupMember"
import type { InviteLink, CreateInviteLinkInput } from "../entities/InviteLink"

/**
 * グループリポジトリインターフェース
 */
export interface GroupRepository {
  // === グループ ===

  /** グループを作成（オーナーも同時に作成） */
  createWithOwner(input: CreateGroupInput): Promise<Group>

  /** グループをIDで取得 */
  findById(id: string): Promise<Group | null>

  /** ユーザーが所属するグループ一覧を取得 */
  findByUserId(userId: string): Promise<Group[]>

  /** グループを更新 */
  update(input: UpdateGroupInput): Promise<Group>

  /** グループを削除 */
  delete(id: string): Promise<void>

  // === メンバー ===

  /** メンバーを追加 */
  addMember(input: CreateGroupMemberInput): Promise<GroupMember>

  /** メンバーを削除 */
  removeMember(groupId: string, userId: string): Promise<void>

  /** グループメンバー一覧を取得（ユーザー情報付き） */
  findMembers(groupId: string): Promise<GroupMemberWithUser[]>

  /** ユーザーがグループに所属しているか確認 */
  isMember(groupId: string, userId: string): Promise<boolean>

  /** ユーザーがグループのオーナーか確認 */
  isOwner(groupId: string, userId: string): Promise<boolean>

  // === 招待 ===

  /** 招待リンクを作成 */
  createInvite(input: CreateInviteLinkInput): Promise<InviteLink>

  /** トークンで招待リンクを取得 */
  findInviteByToken(token: string): Promise<InviteLink | null>

  /** 招待リンクを使用済みにする */
  markInviteAsUsed(id: string, userId: string): Promise<void>
}
