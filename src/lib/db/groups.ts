import { db, generateId, type Group, type GroupMember } from "./index"

// グループ一覧取得
export async function getGroups(): Promise<Group[]> {
  return db.groups.orderBy("createdAt").reverse().toArray()
}

// グループ取得
export async function getGroupById(id: string): Promise<Group | undefined> {
  return db.groups.get(id)
}

// グループ作成
export async function createGroup(name: string, ownerId: string, ownerName: string, ownerEmail: string): Promise<Group> {
  const now = new Date()
  const group: Group = {
    id: generateId(),
    name,
    ownerId,
    inviteCode: generateInviteCode(),
    createdAt: now,
    updatedAt: now,
  }

  await db.transaction("rw", [db.groups, db.groupMembers], async () => {
    await db.groups.add(group)

    // オーナーをメンバーとして追加
    const member: GroupMember = {
      id: generateId(),
      groupId: group.id,
      userId: ownerId,
      userName: ownerName,
      userEmail: ownerEmail,
      role: "owner",
      joinedAt: now,
    }
    await db.groupMembers.add(member)
  })

  return group
}

// グループ名更新
export async function updateGroupName(id: string, name: string): Promise<void> {
  await db.groups.update(id, { name, updatedAt: new Date() })
}

// グループ削除
export async function deleteGroup(id: string): Promise<void> {
  await db.transaction("rw", [db.groups, db.groupMembers], async () => {
    await db.groupMembers.where("groupId").equals(id).delete()
    await db.groups.delete(id)
  })
}

// 招待コード再生成
export async function regenerateInviteCode(groupId: string): Promise<string> {
  const newCode = generateInviteCode()
  await db.groups.update(groupId, { inviteCode: newCode, updatedAt: new Date() })
  return newCode
}

// グループメンバー取得
export async function getGroupMembers(groupId: string): Promise<GroupMember[]> {
  return db.groupMembers.where("groupId").equals(groupId).toArray()
}

// メンバー追加（招待承認時）
export async function addGroupMember(
  groupId: string,
  userId: string,
  userName: string,
  userEmail: string
): Promise<GroupMember> {
  const member: GroupMember = {
    id: generateId(),
    groupId,
    userId,
    userName,
    userEmail,
    role: "member",
    joinedAt: new Date(),
  }
  await db.groupMembers.add(member)
  return member
}

// メンバー削除
export async function removeGroupMember(memberId: string): Promise<void> {
  await db.groupMembers.delete(memberId)
}

// グループから退出（自分自身）
export async function leaveGroup(groupId: string, userId: string): Promise<void> {
  const members = await db.groupMembers.where("groupId").equals(groupId).toArray()
  const myMembership = members.find((m) => m.userId === userId)
  if (myMembership) {
    await db.groupMembers.delete(myMembership.id)
  }
}

// 招待コードからグループを検索
export async function getGroupByInviteCode(inviteCode: string): Promise<Group | undefined> {
  return db.groups.where("inviteCode").equals(inviteCode).first()
}

// ユーザーが所属するグループを取得
export async function getGroupsByUserId(userId: string): Promise<Group[]> {
  const memberships = await db.groupMembers.where("userId").equals(userId).toArray()
  const groupIds = memberships.map((m) => m.groupId)
  const groups = await db.groups.bulkGet(groupIds)
  return groups.filter((g): g is Group => g !== undefined)
}

// 招待コードでグループに参加
export async function joinGroupByInviteCode(
  inviteCode: string,
  userId: string,
  userName: string,
  userEmail: string
): Promise<{ success: boolean; group?: Group; error?: string }> {
  // 招待コードからグループを検索
  const group = await getGroupByInviteCode(inviteCode.toUpperCase())
  if (!group) {
    return { success: false, error: "招待コードが見つかりません" }
  }

  // すでにメンバーかどうかチェック
  const existingMember = await db.groupMembers
    .where(["groupId", "userId"])
    .equals([group.id, userId])
    .first()
  if (existingMember) {
    return { success: false, error: "すでにこのグループのメンバーです" }
  }

  // メンバーとして追加
  await addGroupMember(group.id, userId, userName, userEmail)
  return { success: true, group }
}

// 招待コード生成（6文字の英数字）
function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // 紛らわしい文字を除外
  let code = ""
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}
