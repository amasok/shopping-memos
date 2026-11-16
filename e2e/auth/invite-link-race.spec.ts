import { test, expect } from "@playwright/test"
import { seedGroup, getUser, testUUID } from "./fixtures/db-helpers"
import { USER_A_EMAIL, USER_B_EMAIL, USER_B_STORAGE } from "./fixtures/auth-helpers"
import { trpcMutation, trpcMutationStatus, trpcQuery } from "./fixtures/trpc-helpers"

/**
 * #73-2: 招待リンクの承認は、確保（使用済みにする）とメンバーの追加を 1 つのトランザクションで行う（実 DB）。
 * 同じ招待リンクを同時に承認しても、メンバーになれるのは 1 回だけで、使用済みの招待リンクは再利用できない。
 */
test.describe("招待リンクの承認の同時実行 (#73-2)", () => {
  let userA: { id: string }
  let userB: { id: string }

  test.beforeAll(async () => {
    userA = await getUser(USER_A_EMAIL)
    userB = await getUser(USER_B_EMAIL)
  })

  async function createGroupAndInvite(request: Parameters<typeof trpcMutation>[0]) {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "招待リンクの同時実行",
      ownerUserId: userA.id,
      inviteCode: testUUID().slice(0, 6).toUpperCase(),
    })
    const { token } = await trpcMutation<{ token: string }>(request, "identity.inviteMember", { groupId })
    return { groupId, token }
  }

  test("同じユーザーが同じ招待リンクを同時に 2 回承認しても、参加できるのは 1 回だけで、メンバーは重複しない", async ({
    request,
    browser,
  }) => {
    const { groupId, token } = await createGroupAndInvite(request)
    const bContext = await browser.newContext({ storageState: USER_B_STORAGE })
    try {
      const statuses = await Promise.all([
        trpcMutationStatus(bContext.request, "identity.acceptInvite", { token }),
        trpcMutationStatus(bContext.request, "identity.acceptInvite", { token }),
      ])

      expect(statuses.filter((s) => s === 200)).toHaveLength(1)
      expect(statuses.filter((s) => s === 400)).toHaveLength(1)

      // メンバーは、オーナー（A）と B の 2 人だけ
      const members = await trpcQuery<Array<{ userId: string }>>(request, "identity.getGroupMembers", { groupId })
      expect(members.map((m) => m.userId).sort()).toEqual([userA.id, userB.id].sort())
    } finally {
      await bContext.close()
    }
  })

  test("使用済みの招待リンクは、あとから承認しようとしても拒否される", async ({ request, browser }) => {
    const { groupId, token } = await createGroupAndInvite(request)
    const bContext = await browser.newContext({ storageState: USER_B_STORAGE })
    try {
      expect(await trpcMutationStatus(bContext.request, "identity.acceptInvite", { token })).toBe(200)

      expect(await trpcMutationStatus(bContext.request, "identity.acceptInvite", { token })).toBe(400)
      const members = await trpcQuery<unknown[]>(request, "identity.getGroupMembers", { groupId })
      expect(members).toHaveLength(2)
    } finally {
      await bContext.close()
    }
  })
})
