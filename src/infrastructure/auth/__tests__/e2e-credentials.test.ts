// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { selectResults, inserted } = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  inserted: [] as unknown[],
}))

vi.mock("@/infrastructure/db/drizzle/client", () => ({
  db: {
    select: () => ({
      from: () => ({ where: async () => selectResults.shift() ?? [] }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        inserted.push(v)
        return { returning: async () => [v] }
      },
    }),
  },
}))

import { authorizeE2EUser, e2eCredentialsProviders } from "../e2e-credentials"

const TOKEN = "t".repeat(64)
const req = (token: string | null = TOKEN) => ({
  headers: new Headers(token === null ? {} : { "x-e2e-token": token }),
})

beforeEach(() => {
  vi.stubEnv("E2E_BUILD", "true")
  vi.stubEnv("E2E_TEST", "true")
  vi.stubEnv("E2E_SEED_TOKEN", TOKEN)
  vi.stubEnv("VERCEL_ENV", "")
  selectResults.length = 0
  inserted.length = 0
})

afterEach(() => vi.unstubAllEnvs())

describe("e2eCredentialsProviders", () => {
  it("E2E_BUILD のビルドで実行時の条件がそろえば Credentials プロバイダを登録する", () => {
    const providers = e2eCredentialsProviders()
    expect(providers).toHaveLength(1)
    expect((providers[0] as { id: string }).id).toBe("credentials")
  })

  it("E2E_BUILD のビルドでなければ登録しない", () => {
    vi.stubEnv("E2E_BUILD", "false")
    expect(e2eCredentialsProviders()).toEqual([])
  })

  it("E2E_TEST が未設定なら登録しない", () => {
    vi.stubEnv("E2E_TEST", "")
    expect(e2eCredentialsProviders()).toEqual([])
  })

  it.each(["production", "preview"])("VERCEL_ENV=%s なら登録しない", (env) => {
    vi.stubEnv("VERCEL_ENV", env)
    expect(e2eCredentialsProviders()).toEqual([])
  })

  it("E2E_SEED_TOKEN が未設定なら登録しない", () => {
    vi.stubEnv("E2E_SEED_TOKEN", "")
    expect(e2eCredentialsProviders()).toEqual([])
  })
})

describe("authorizeE2EUser", () => {
  it("x-e2e-token がない・不一致ならログインさせない", async () => {
    expect(await authorizeE2EUser({ email: "user-a@e2e-test.local" }, req(null))).toBeNull()
    expect(await authorizeE2EUser({ email: "user-a@e2e-test.local" }, req("x".repeat(64)))).toBeNull()
  })

  it("E2E_BUILD のビルドでなければログインさせない", async () => {
    vi.stubEnv("E2E_BUILD", "false")
    expect(await authorizeE2EUser({ email: "user-a@e2e-test.local" }, req())).toBeNull()
  })

  it("E2E 用ドメイン以外のアカウントにはなりすませない", async () => {
    selectResults.push([{ id: "real", email: "someone@example.com" }])
    expect(await authorizeE2EUser({ email: "someone@example.com" }, req())).toBeNull()
    expect(inserted).toHaveLength(0)
  })

  it("メールアドレスがなければログインさせない", async () => {
    expect(await authorizeE2EUser({}, req())).toBeNull()
    expect(await authorizeE2EUser(undefined, req())).toBeNull()
  })

  it("既存の E2E 用ユーザーとしてログインする", async () => {
    const user = { id: "u1", email: "user-a@e2e-test.local" }
    selectResults.push([user])
    expect(await authorizeE2EUser({ email: "User-A@e2e-test.local" }, req())).toEqual(user)
    expect(inserted).toHaveLength(0)
  })

  it("E2E 用ユーザーがいなければ作成する", async () => {
    const result = await authorizeE2EUser({ email: "user-b@e2e-test.local" }, req())
    expect(result).toMatchObject({ email: "user-b@e2e-test.local" })
    expect(inserted).toHaveLength(1)
  })
})
