// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * drizzle のクエリビルダーの代わり。select() の結果を呼び出し順に返す。
 * insert / delete は呼ばれたことだけを記録する
 */
const { selectResults, inserts, deletes } = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  inserts: [] as unknown[],
  deletes: [] as unknown[],
}))

vi.mock("@/infrastructure/db/drizzle/client", () => {
  const chain = (result: () => Promise<unknown>) => {
    const c: Record<string, unknown> = {}
    for (const m of ["from", "where", "innerJoin", "returning"]) c[m] = () => c
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      result().then(resolve, reject)
    return c
  }
  return {
    db: {
      select: () =>
        chain(async () => {
          const next = selectResults.shift()
          if (next instanceof Error) throw next
          return next ?? []
        }),
      insert: (table: unknown) => ({
        values: (v: unknown) => {
          inserts.push({ table, v })
          return chain(async () => [v])
        },
      }),
      delete: (table: unknown) => {
        deletes.push(table)
        return chain(async () => [])
      },
    },
  }
})

import { POST } from "../route.e2e"
import { groupMembers, groups } from "@/infrastructure/db/drizzle/schema"

const TOKEN = "t".repeat(64)
const E2E_USER = [{ email: "user-a@e2e-test.local" }]
const REAL_USER = [{ email: "someone@example.com" }]
/** グループのオーナーを引く select の結果 */
const owner = (groupId: string, email: string) => [{ groupId, email }]

function post(body: unknown, token: string | null = TOKEN) {
  return POST(
    new Request("http://localhost/api/e2e/seed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token === null ? {} : { "x-e2e-token": token }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  vi.stubEnv("E2E_TEST", "true")
  vi.stubEnv("E2E_SEED_TOKEN", TOKEN)
  vi.stubEnv("VERCEL_ENV", "")
  selectResults.length = 0
  inserts.length = 0
  deletes.length = 0
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("POST /api/e2e/seed の有効化条件", () => {
  it("E2E_TEST が未設定なら 404", async () => {
    vi.stubEnv("E2E_TEST", "")
    expect((await post({ action: "cleanup" })).status).toBe(404)
  })

  it.each(["production", "preview"])("VERCEL_ENV=%s なら 404", async (env) => {
    vi.stubEnv("VERCEL_ENV", env)
    expect((await post({ action: "cleanup" })).status).toBe(404)
  })

  it("x-e2e-token がない・不一致なら 404", async () => {
    expect((await post({ action: "cleanup" }, null)).status).toBe(404)
    expect((await post({ action: "cleanup" }, "x".repeat(64))).status).toBe(404)
  })

  it("E2E_SEED_TOKEN が未設定なら、ヘッダが空でも 404", async () => {
    vi.stubEnv("E2E_SEED_TOKEN", "")
    expect((await post({ action: "cleanup" }, "")).status).toBe(404)
  })

  it("NODE_ENV=production でも条件がそろえば応答する", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const res = await post({ action: "cleanup" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, deletedUsers: 0 })
  })
})

describe("POST /api/e2e/seed のアクション", () => {
  it("debug-session は廃止され 400 を返す", async () => {
    const res = await post({ action: "debug-session" })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).not.toContain("session")
  })

  it("JSON でない本文は 400", async () => {
    expect((await post("not json")).status).toBe(400)
  })

  it("get-user は id・email・name だけを返す", async () => {
    selectResults.push([{ id: "u1", email: "user-a@e2e-test.local", name: "A" }])
    const res = await post({ action: "get-user", data: { email: "user-a@e2e-test.local" } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      user: { id: "u1", email: "user-a@e2e-test.local", name: "A" },
    })
  })

  it("get-user は E2E 用ドメイン以外のメールアドレスを拒否する", async () => {
    const res = await post({ action: "get-user", data: { email: "someone@example.com" } })
    expect(res.status).toBe(403)
  })

  it("seed-group は E2E 用ドメイン以外のユーザーをオーナーにできない", async () => {
    selectResults.push(REAL_USER)
    const res = await post({
      action: "seed-group",
      data: { groupId: "g1", groupName: "G", ownerUserId: "real", inviteCode: "ABC" },
    })
    expect(res.status).toBe(403)
    expect(inserts).toHaveLength(0)
  })

  it("seed-group は E2E 用ユーザーなら作成する", async () => {
    selectResults.push(E2E_USER)
    const res = await post({
      action: "seed-group",
      data: {
        groupId: "g1",
        groupName: "G",
        ownerUserId: "u1",
        inviteCode: "ABC",
        inviteCodeExpiresAt: new Date().toISOString(),
      },
    })
    expect(res.status).toBe(200)
    expect(inserts).toHaveLength(2)
  })

  it("seed-group は不正な入力を 400 にする", async () => {
    const res = await post({ action: "seed-group", data: { groupId: "g1" } })
    expect(res.status).toBe(400)
  })

  it("add-group-member は E2E 用ドメイン以外のユーザーを追加できない", async () => {
    selectResults.push(REAL_USER)
    const res = await post({ action: "add-group-member", data: { groupId: "g1", userId: "real" } })
    expect(res.status).toBe(403)
    expect(inserts).toHaveLength(0)
  })

  it("add-group-member はオーナーが E2E 用ユーザーでないグループには追加できない", async () => {
    selectResults.push(E2E_USER, owner("real-group", "someone@example.com"))
    const res = await post({ action: "add-group-member", data: { groupId: "real-group", userId: "u1" } })
    expect(res.status).toBe(403)
    expect(inserts).toHaveLength(0)
  })

  it("add-group-member は存在しないグループには追加できない", async () => {
    selectResults.push(E2E_USER, [])
    const res = await post({ action: "add-group-member", data: { groupId: "none", userId: "u1" } })
    expect(res.status).toBe(403)
  })

  it("add-group-member は E2E 用ユーザーと E2E 用グループなら追加する", async () => {
    selectResults.push(E2E_USER, owner("g1", "user-a@e2e-test.local"))
    const res = await post({ action: "add-group-member", data: { groupId: "g1", userId: "u2" } })
    expect(res.status).toBe(200)
    expect(inserts).toHaveLength(1)
  })

  it("seed-items は E2E 用ドメイン以外のユーザーのアイテムを作れない", async () => {
    selectResults.push(REAL_USER)
    const res = await post({
      action: "seed-items",
      data: { userId: "real", items: [{ id: "i1", name: "牛乳" }] },
    })
    expect(res.status).toBe(403)
  })

  it("seed-items は E2E 用以外のグループにアイテムを作れない", async () => {
    selectResults.push(E2E_USER, owner("real-group", "someone@example.com"))
    const res = await post({
      action: "seed-items",
      data: { userId: "u1", groupId: "real-group", items: [{ id: "i1", name: "牛乳" }] },
    })
    expect(res.status).toBe(403)
  })

  it("seed-items は E2E 用ユーザーのアイテムを作成する", async () => {
    selectResults.push(E2E_USER, owner("g1", "user-a@e2e-test.local"))
    const res = await post({
      action: "seed-items",
      data: { userId: "u1", groupId: "g1", items: [{ id: "i1", name: "牛乳" }, { id: "i2", name: "卵" }] },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, count: 2 })
  })

  it("cleanup は E2E ユーザーが参加しているだけのほかのユーザーのグループを消さない", async () => {
    // e2e ユーザー → 所属グループ → オーナー（E2E ではない）→ リスト・アイテム
    selectResults.push([{ id: "u1" }], [{ groupId: "real-group" }], owner("real-group", "someone@example.com"))
    const res = await post({ action: "cleanup" })
    expect(res.status).toBe(200)
    expect(deletes).not.toContain(groups)
    expect(deletes).not.toContain(groupMembers)
  })

  it("cleanup は E2E ユーザーがオーナーのグループを消す", async () => {
    selectResults.push([{ id: "u1" }], [{ groupId: "g1" }], owner("g1", "user-a@e2e-test.local"))
    const res = await post({ action: "cleanup" })
    expect(res.status).toBe(200)
    expect(deletes).toContain(groups)
  })

  it("cleanup-groups はほかのユーザーのグループを消さず、E2E ユーザーのメンバーシップだけを外す", async () => {
    selectResults.push([{ id: "u1" }], [{ groupId: "real-group" }], owner("real-group", "someone@example.com"))
    const res = await post({ action: "cleanup-groups" })
    expect(res.status).toBe(200)
    expect(deletes).not.toContain(groups)
    expect(deletes).toContain(groupMembers)
  })

  it("cleanup-groups は E2E ユーザーがオーナーのグループを消す", async () => {
    selectResults.push([{ id: "u1" }], [{ groupId: "g1" }], owner("g1", "user-a@e2e-test.local"))
    const res = await post({ action: "cleanup-groups" })
    expect(res.status).toBe(200)
    expect(deletes).toContain(groups)
  })

  it("DB のエラー内容をレスポンスに含めない", async () => {
    selectResults.push(new Error('relation "users" does not exist') as unknown as unknown[])
    const res = await post({ action: "cleanup" })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: "Internal error" })
    expect(JSON.stringify(body)).not.toContain("relation")
  })
})
