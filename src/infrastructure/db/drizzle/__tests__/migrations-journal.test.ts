// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * drizzle のマイグレーションの _journal.json の整合性
 *
 * drizzle の migrator は、最後に当てたマイグレーションの when（folderMillis）以下のものを黙って飛ばす。
 * when が順に大きくなっていないと、新しいマイグレーションが本番で当たらないまま成功扱いになる。
 */
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations")

type Journal = { entries: Array<{ idx: number; when: number; tag: string }> }

const journal: Journal = JSON.parse(
  readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")
)

describe("マイグレーションの _journal.json", () => {
  it("idx が 0 から順に並んでいる", () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i))
  })

  it("when が順に大きくなっている", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      expect(
        journal.entries[i].when,
        `${journal.entries[i].tag} の when が ${journal.entries[i - 1].tag} 以下`
      ).toBeGreaterThan(journal.entries[i - 1].when)
    }
  })

  it("各エントリーの SQL ファイルがある", () => {
    for (const entry of journal.entries) {
      expect(existsSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`)), entry.tag).toBe(true)
    }
  })

  it("journal にない SQL ファイルがない", () => {
    const tags = new Set(journal.entries.map((e) => e.tag))
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))
    expect(files.filter((f) => !tags.has(f.replace(/\.sql$/, "")))).toEqual([])
  })
})
