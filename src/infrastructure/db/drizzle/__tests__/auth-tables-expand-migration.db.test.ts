// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Better Auth 用のテーブルを足す expand マイグレーション（#61 A2）を、実 DB で確かめるテスト
 *
 * DB_TEST_URL があるときだけ流す（なければスキップ）。流し方: npm run test:db
 * DB_TEST_URL のサーバーに、このテスト専用の DB を作って 0000〜0005 を当て、Google でログインした
 * 既存ユーザーのデータを入れてから 0006 を当てる。終わったら DB を消す。
 */
const TEST_DB_URL = process.env.DB_TEST_URL

// DB を作って消すので、ローカルの DB 以外では流さない
if (TEST_DB_URL && !["localhost", "127.0.0.1"].includes(new URL(TEST_DB_URL).hostname)) {
  throw new Error("DB_TEST_URL は localhost / 127.0.0.1 の DB だけ指定できます")
}

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations")
const TARGET_TAG = "0006_auth_tables_expand"
const NEW_TABLES = [
  "auth_sessions",
  "auth_accounts",
  "auth_verifications",
  "passkeys",
  "rate_limits",
  "otp_events",
] as const
const OLD_TABLES = ["accounts", "sessions", "verification_tokens"] as const

type Journal = { entries: Array<{ idx: number; tag: string }> }

/** drizzle の migrator と同じく、`--> statement-breakpoint` で区切って 1 トランザクションで流す */
async function applyMigration(sql: postgres.Sql, tag: string) {
  const file = readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8")
  await sql.begin(async (tx) => {
    for (const statement of file.split("--> statement-breakpoint")) {
      if (statement.trim()) await tx.unsafe(statement)
    }
  })
}

/** テスト専用の DB を作り、0006 の手前までのマイグレーションを当てる */
async function createDbBeforeTarget(admin: postgres.Sql, dbName: string): Promise<postgres.Sql> {
  await admin.unsafe(`CREATE DATABASE "${dbName}"`)
  const url = new URL(TEST_DB_URL!)
  url.pathname = `/${dbName}`
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} })

  const journal: Journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")
  )
  const target = journal.entries.find((e) => e.tag === TARGET_TAG)
  expect(target, `${TARGET_TAG} が _journal.json にない`).toBeDefined()
  for (const entry of journal.entries.filter((e) => e.idx < target!.idx)) {
    await applyMigration(sql, entry.tag)
  }
  return sql
}

function uniqueDbName(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

describe.skipIf(!TEST_DB_URL)("Better Auth 用テーブルの expand マイグレーション（実 DB）", () => {
  const dbName = uniqueDbName("sm_a2")
  let admin: postgres.Sql
  let sql: postgres.Sql

  const VERIFIED_AT = "2026-01-01 00:00:00"

  beforeAll(async () => {
    admin = postgres(TEST_DB_URL!, { max: 1, onnotice: () => {} })
    sql = await createDbBeforeTarget(admin, dbName)

    // Google でログインした家族（大文字・前後の空白を含む email、email_verified は timestamp）
    await sql`INSERT INTO users (id, name, email, email_verified, image)
      VALUES ('u-mama', 'ママ', ' Mama.Family@Gmail.com ', ${VERIFIED_AT}, 'https://lh3.googleusercontent.com/a')`
    // 名前がなく、メールが未確認のユーザー（E2E の Credentials で作られた行など）
    await sql`INSERT INTO users (id, name, email) VALUES ('u-kid', NULL, 'kid@e2e-test.local')`
    await sql`INSERT INTO accounts (user_id, type, provider, provider_account_id, access_token, refresh_token)
      VALUES ('u-mama', 'oauth', 'google', 'google-sub-1', 'ya29.dummy', '1//dummy')`
    await sql`INSERT INTO sessions (session_token, user_id, expires) VALUES ('old-session', 'u-mama', '2027-01-01')`
    await sql`INSERT INTO verification_tokens (identifier, token, expires) VALUES ('x', 'y', '2027-01-01')`
    await sql`INSERT INTO groups (id, name, invite_code) VALUES ('g1', '家族', 'A2TEST01')`
    await sql`INSERT INTO group_members (id, group_id, user_id, role) VALUES ('gm1', 'g1', 'u-mama', 'owner')`
    await sql`INSERT INTO items (id, name, user_id, group_id) VALUES ('i1', '牛乳', 'u-mama', 'g1')`

    await applyMigration(sql, TARGET_TAG)
  })

  afterAll(async () => {
    await sql?.end()
    await admin?.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
    await admin?.end()
  })

  async function tableExists(table: string) {
    const rows = await sql`SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}`
    return rows.length === 1
  }

  it("users の行と ID が残り、グループ・アイテムの外部キーもそのまま", async () => {
    const users = await sql<{ id: string }[]>`SELECT id FROM users ORDER BY id`
    expect(users.map((u) => u.id)).toEqual(["u-kid", "u-mama"])
    const [member] = await sql`SELECT user_id FROM group_members WHERE id = 'gm1'`
    expect(member.user_id).toBe("u-mama")
    const [item] = await sql`SELECT user_id, group_id FROM items WHERE id = 'i1'`
    expect(item).toEqual({ user_id: "u-mama", group_id: "g1" })
  })

  it("email を trim して小文字にそろえる", async () => {
    const [mama] = await sql`SELECT email FROM users WHERE id = 'u-mama'`
    expect(mama.email).toBe("mama.family@gmail.com")
  })

  it("email_verified_flag を足し、email_verified が入っている行だけ true にする", async () => {
    const rows = await sql<{ id: string; email_verified_flag: boolean }[]>`
      SELECT id, email_verified_flag FROM users ORDER BY id`
    expect(rows).toEqual([
      { id: "u-kid", email_verified_flag: false },
      { id: "u-mama", email_verified_flag: true },
    ])
    const [column] = await sql`SELECT data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email_verified_flag'`
    expect(column).toEqual({ data_type: "boolean", is_nullable: "NO", column_default: "false" })
  })

  it("name の NULL を '' にし、ある名前はそのまま（制約は付けない）", async () => {
    const rows = await sql<{ id: string; name: string | null }[]>`SELECT id, name FROM users ORDER BY id`
    expect(rows).toEqual([
      { id: "u-kid", name: "" },
      { id: "u-mama", name: "ママ" },
    ])
    const [column] = await sql`SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'name'`
    expect(column.is_nullable).toBe("YES")
  })

  it("Auth.js のテーブルと users の旧列（email_verified・image）は残り、行も変わらない", async () => {
    for (const table of OLD_TABLES) expect(await tableExists(table), table).toBe(true)
    const [account] = await sql`SELECT provider, access_token, refresh_token FROM accounts WHERE user_id = 'u-mama'`
    expect(account).toEqual({ provider: "google", access_token: "ya29.dummy", refresh_token: "1//dummy" })
    const [session] = await sql`SELECT user_id FROM sessions WHERE session_token = 'old-session'`
    expect(session.user_id).toBe("u-mama")
    const [mama] = await sql`SELECT email_verified, image FROM users WHERE id = 'u-mama'`
    expect(mama.email_verified).not.toBeNull()
    expect(mama.image).toBe("https://lh3.googleusercontent.com/a")
  })

  it.each(NEW_TABLES)("%s ができている", async (table) => {
    expect(await tableExists(table)).toBe(true)
  })

  it("旧コード（Auth.js）と同じ書き方で users・accounts・sessions に書き込める", async () => {
    // Auth.js の DrizzleAdapter は email_verified_flag を知らない
    await sql`INSERT INTO users (id, name, email, email_verified) VALUES ('u-new', 'パパ', 'papa@gmail.com', now())`
    await sql`INSERT INTO accounts (user_id, type, provider, provider_account_id)
      VALUES ('u-new', 'oauth', 'google', 'google-sub-2')`
    await sql`INSERT INTO sessions (session_token, user_id, expires) VALUES ('new-session', 'u-new', '2027-01-01')`
    const [row] = await sql`SELECT email_verified_flag FROM users WHERE id = 'u-new'`
    expect(row.email_verified_flag).toBe(false)
  })

  it("Better Auth の行を書き込め、ユーザーを消すとセッション・アカウント・パスキーも消える", async () => {
    await sql`INSERT INTO users (id, name, email) VALUES ('u-tmp', '', 'tmp@example.com')`
    await sql`INSERT INTO auth_sessions (id, expires_at, token, user_id) VALUES ('s1', '2027-01-01', 'tok-1', 'u-tmp')`
    await sql`INSERT INTO auth_accounts (id, account_id, provider_id, user_id) VALUES ('a1', 'u-tmp', 'credential', 'u-tmp')`
    await sql`INSERT INTO passkeys (id, public_key, user_id, credential_id, counter, device_type, backed_up)
      VALUES ('p1', 'pk', 'u-tmp', 'cred-1', 0, 'multiDevice', true)`
    await sql`INSERT INTO auth_verifications (id, identifier, value, expires_at)
      VALUES ('v1', 'sign-in-otp-tmp@example.com', 'hash:1', '2027-01-01')`
    await sql`INSERT INTO rate_limits (id, key, count, last_request) VALUES ('r1', '127.0.0.1/x', 1, ${Date.now()})`

    await sql`DELETE FROM users WHERE id = 'u-tmp'`
    for (const table of ["auth_sessions", "auth_accounts", "passkeys"]) {
      const rows = await sql.unsafe(`SELECT 1 FROM ${table} WHERE user_id = 'u-tmp'`)
      expect(rows, table).toHaveLength(0)
    }
  })

  it("一意の制約: auth_sessions.token・passkeys.credential_id・rate_limits.key", async () => {
    await sql`INSERT INTO auth_sessions (id, expires_at, token, user_id) VALUES ('s2', '2027-01-01', 'dup', 'u-mama')`
    await expect(
      sql`INSERT INTO auth_sessions (id, expires_at, token, user_id) VALUES ('s3', '2027-01-01', 'dup', 'u-mama')`
    ).rejects.toThrow(/auth_sessions_token_unique/)
    await sql`INSERT INTO passkeys (id, public_key, user_id, credential_id, counter, device_type, backed_up)
      VALUES ('p2', 'pk', 'u-mama', 'cred-dup', 0, 'singleDevice', false)`
    await expect(
      sql`INSERT INTO passkeys (id, public_key, user_id, credential_id, counter, device_type, backed_up)
        VALUES ('p3', 'pk', 'u-mama', 'cred-dup', 0, 'singleDevice', false)`
    ).rejects.toThrow(/passkeys_credential_id_unique/)
    await sql`INSERT INTO rate_limits (id, key, count, last_request) VALUES ('r2', 'k-dup', 1, 0)`
    await expect(
      sql`INSERT INTO rate_limits (id, key, count, last_request) VALUES ('r3', 'k-dup', 1, 0)`
    ).rejects.toThrow(/rate_limits_key_unique/)
  })

  it("otp_events の kind は sent / failed / locked / unlocked だけ", async () => {
    for (const [i, kind] of ["sent", "failed", "locked", "unlocked"].entries()) {
      await sql`INSERT INTO otp_events (id, email_hash, ip, kind) VALUES (${`e${i}`}, 'h', '203.0.113.1', ${kind})`
    }
    await sql`INSERT INTO otp_events (id, email_hash, ip, kind) VALUES ('e-noip', 'h', NULL, 'sent')`
    await expect(
      sql`INSERT INTO otp_events (id, email_hash, kind) VALUES ('e-bad', 'h', 'bogus')`
    ).rejects.toThrow(/otp_events_kind_check/)
  })

  it("otp_events に判定・監視用のインデックスがある", async () => {
    const rows = await sql<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'otp_events'`
    const defs = rows.map((r) => r.indexdef)
    expect(defs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("(email_hash, created_at)"),
        expect.stringContaining("(email_hash, ip, created_at)"),
        expect.stringContaining("(kind, created_at)"),
      ])
    )
  })

  it("もう一度流しても失敗せず、データも変わらない（冪等）", async () => {
    const before = await sql`SELECT id, email, name FROM users ORDER BY id`
    await applyMigration(sql, TARGET_TAG)
    const after = await sql`SELECT id, email, name FROM users ORDER BY id`
    expect(after).toEqual(before)
    // 流し直すと、その間に旧コードが email_verified を入れた行（u-new）の値も写す
    const flags = await sql<{ id: string; email_verified_flag: boolean }[]>`
      SELECT id, email_verified_flag FROM users WHERE id IN ('u-mama', 'u-kid', 'u-new') ORDER BY id`
    expect(flags).toEqual([
      { id: "u-kid", email_verified_flag: false },
      { id: "u-mama", email_verified_flag: true },
      { id: "u-new", email_verified_flag: true },
    ])
  })
})

describe.skipIf(!TEST_DB_URL)("正規化すると email が重複するとき（実 DB）", () => {
  const dbName = uniqueDbName("sm_a2dup")
  let admin: postgres.Sql
  let sql: postgres.Sql

  beforeAll(async () => {
    admin = postgres(TEST_DB_URL!, { max: 1, onnotice: () => {} })
    sql = await createDbBeforeTarget(admin, dbName)
    await sql`INSERT INTO users (id, email) VALUES ('u1', 'Taro@Example.com'), ('u2', 'taro@example.com ')`
  })

  afterAll(async () => {
    await sql?.end()
    await admin?.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
    await admin?.end()
  })

  it("マイグレーションが失敗し、何も変わらない", async () => {
    await expect(applyMigration(sql, TARGET_TAG)).rejects.toThrow(/重複するアドレスが 1 件/)

    const users = await sql`SELECT id, email FROM users ORDER BY id`
    expect(users).toEqual([
      { id: "u1", email: "Taro@Example.com" },
      { id: "u2", email: "taro@example.com " },
    ])
    const [column] = await sql`SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email_verified_flag'`
    expect(column.n).toBe(0)
    const [table] = await sql`SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'auth_sessions'`
    expect(table.n).toBe(0)
  })
})
