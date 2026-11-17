// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * 同期用の列を足す expand マイグレーション（#62 O3）を、実 DB で確かめるテスト
 *
 * DB_TEST_URL があるときだけ流す（なければスキップ）。流し方: npm run test:db
 * DB_TEST_URL のサーバーに、このテスト専用の DB を作って 0000〜0004 を当て、既存の行を入れてから
 * 0005 を当てる。終わったら DB を消す。
 */
const TEST_DB_URL = process.env.DB_TEST_URL

// DB を作って消すので、ローカルの DB 以外では流さない
if (TEST_DB_URL && !["localhost", "127.0.0.1"].includes(new URL(TEST_DB_URL).hostname)) {
  throw new Error("DB_TEST_URL は localhost / 127.0.0.1 の DB だけ指定できます")
}

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations")
const TARGET_TAG = "0005_sync_columns"
const SYNC_TABLES = ["items", "tags", "shopping_lists", "list_items"] as const

type Journal = { entries: Array<{ idx: number; tag: string }> }

/** drizzle の migrator と同じく、`--> statement-breakpoint` で区切って 1 文ずつ流す */
async function applyMigration(sql: postgres.Sql, tag: string) {
  const file = readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8")
  await sql.begin(async (tx) => {
    for (const statement of file.split("--> statement-breakpoint")) {
      if (statement.trim()) await tx.unsafe(statement)
    }
  })
}

describe.skipIf(!TEST_DB_URL)("同期用の列のマイグレーション（実 DB）", () => {
  const dbName = `sm_o3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  let admin: postgres.Sql
  let sql: postgres.Sql

  const OLD = "2026-01-01 00:00:00"
  const ITEM_UPDATED = "2026-02-01 00:00:00"

  beforeAll(async () => {
    admin = postgres(TEST_DB_URL!, { max: 1, onnotice: () => {} })
    await admin.unsafe(`CREATE DATABASE "${dbName}"`)
    const url = new URL(TEST_DB_URL!)
    url.pathname = `/${dbName}`
    sql = postgres(url.toString(), { max: 1, onnotice: () => {} })

    const journal: Journal = JSON.parse(
      readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")
    )
    const target = journal.entries.find((e) => e.tag === TARGET_TAG)
    expect(target, `${TARGET_TAG} が _journal.json にない`).toBeDefined()
    for (const entry of journal.entries.filter((e) => e.idx < target!.idx)) {
      await applyMigration(sql, entry.tag)
    }

    // マイグレーション前からある行
    await sql`INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com')`
    await sql`INSERT INTO groups (id, name, invite_code) VALUES ('g1', 'g', 'O3TEST')`
    await sql`INSERT INTO items (id, name, user_id, group_id, created_at, updated_at)
      VALUES ('i1', 'りんご', 'u1', 'g1', ${OLD}, ${ITEM_UPDATED})`
    await sql`INSERT INTO tags (id, name, user_id, created_at, updated_at)
      VALUES ('t1', '食品', 'u1', ${OLD}, ${ITEM_UPDATED})`
    await sql`INSERT INTO shopping_lists (id, name, user_id, group_id, created_at)
      VALUES ('l1', 'リスト', 'u1', 'g1', ${OLD})`
    await sql`INSERT INTO list_items (id, list_id, name, user_id, created_at)
      VALUES ('li1', 'l1', 'りんご', 'u1', ${OLD})`

    await applyMigration(sql, TARGET_TAG)
  })

  afterAll(async () => {
    await sql?.end()
    await admin?.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
    await admin?.end()
  })

  async function column(table: string, name: string) {
    const rows = await sql<
      { data_type: string; is_nullable: string; column_default: string | null }[]
    >`SELECT data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${name}`
    return rows[0]
  }

  it.each(SYNC_TABLES)("%s に updated_at（NOT NULL・既定値 now()）がある", async (table) => {
    expect(await column(table, "updated_at")).toEqual({
      data_type: "timestamp without time zone",
      is_nullable: "NO",
      column_default: "now()",
    })
  })

  it.each(SYNC_TABLES)("%s に field_modified_at（jsonb・NOT NULL・既定値 {}）がある", async (table) => {
    expect(await column(table, "field_modified_at")).toEqual({
      data_type: "jsonb",
      is_nullable: "NO",
      column_default: "'{}'::jsonb",
    })
  })

  it.each(SYNC_TABLES)("%s に deleted_at（NULL 可・既定値なし）がある", async (table) => {
    expect(await column(table, "deleted_at")).toEqual({
      data_type: "timestamp without time zone",
      is_nullable: "YES",
      column_default: null,
    })
  })

  it.each(SYNC_TABLES)(
    "%s に (group_id, updated_at) と (user_id, updated_at) のインデックスがある",
    async (table) => {
      const rows = await sql<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = ${table}`
      const defs = rows.map((r) => r.indexdef)
      expect(defs).toContainEqual(expect.stringContaining("(group_id, updated_at)"))
      expect(defs).toContainEqual(expect.stringContaining("(user_id, updated_at)"))
    }
  )

  it("updated_at がなかった shopping_lists / list_items の既存行は created_at で埋まる", async () => {
    const lists = await sql`SELECT updated_at = created_at AS same FROM shopping_lists WHERE id = 'l1'`
    const listItems = await sql`SELECT updated_at = created_at AS same FROM list_items WHERE id = 'li1'`
    expect(lists[0].same).toBe(true)
    expect(listItems[0].same).toBe(true)
  })

  it("もともと updated_at があった items / tags の既存行の updated_at は変わらない", async () => {
    const rows = await sql`
      SELECT (SELECT updated_at = ${ITEM_UPDATED}::timestamp FROM items WHERE id = 'i1') AS item,
             (SELECT updated_at = ${ITEM_UPDATED}::timestamp FROM tags WHERE id = 't1') AS tag`
    expect(rows[0]).toEqual({ item: true, tag: true })
  })

  it("既存行の field_modified_at は {}、deleted_at は NULL になる", async () => {
    for (const table of SYNC_TABLES) {
      const rows = await sql.unsafe(`SELECT field_modified_at, deleted_at FROM "${table}"`)
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.field_modified_at).toEqual({})
        expect(row.deleted_at).toBeNull()
      }
    }
  })

  it("新しい行は updated_at・field_modified_at を指定しなくても入る", async () => {
    await sql`INSERT INTO shopping_lists (id, name, user_id) VALUES ('l2', '新しいリスト', 'u1')`
    await sql`INSERT INTO list_items (id, list_id, name, user_id) VALUES ('li2', 'l2', 'みかん', 'u1')`
    const rows = await sql`
      SELECT updated_at IS NOT NULL AS has_updated, field_modified_at FROM list_items WHERE id = 'li2'`
    expect(rows[0]).toEqual({ has_updated: true, field_modified_at: {} })
  })

  it("2 回流しても失敗せず、既存行の値を上書きしない", async () => {
    await sql`UPDATE shopping_lists SET updated_at = '2026-03-01 00:00:00',
      field_modified_at = '{"name": "2026-03-01T00:00:00.000Z"}', deleted_at = '2026-03-02 00:00:00'
      WHERE id = 'l1'`

    await expect(applyMigration(sql, TARGET_TAG)).resolves.toBeUndefined()

    const rows = await sql`
      SELECT updated_at = '2026-03-01 00:00:00'::timestamp AS updated,
             field_modified_at, deleted_at IS NOT NULL AS deleted
      FROM shopping_lists WHERE id = 'l1'`
    expect(rows[0]).toEqual({
      updated: true,
      field_modified_at: { name: "2026-03-01T00:00:00.000Z" },
      deleted: true,
    })
  })
})
