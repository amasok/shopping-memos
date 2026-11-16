// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from "fs"
import path from "path"
import { describe, it, expect } from "vitest"

const root = path.resolve(__dirname, "../..")
const migrationsDir = path.join(root, "src/infrastructure/db/drizzle/migrations")

type Journal = { entries: Array<{ idx: number; when: number; tag: string }> }
const journal = JSON.parse(
  readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf-8")
) as Journal

/**
 * #122: drizzle の migrator は、適用済みの最新の created_at（_journal.json の when）より新しい migration だけを当てる。
 * 時刻の古い migration が後からマージされると、本番では黙って飛ばされる
 */
describe("migration の _journal.json (#122)", () => {
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx)

  it("idx は 0 から欠けずに並んでいる", () => {
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i))
  })

  it("idx の順に when が狭義単調増加している（古い時刻の migration が後ろにない）", () => {
    for (let i = 1; i < entries.length; i++) {
      expect(
        entries[i].when,
        `${entries[i].tag} の when が ${entries[i - 1].tag} 以前。develop を取り込んでから db:generate で作り直す`
      ).toBeGreaterThan(entries[i - 1].when)
    }
  })

  it("journal の migration と SQL ファイルが一致している", () => {
    const sqlFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort()
    expect(entries.map((e) => e.tag).sort()).toEqual(sqlFiles)
  })
})

/**
 * #122: Next.js が AGENTS.md に書き足すブロックが入ると、エージェントのトークン消費が増える
 * - 現行: next dev が書き足すルールのブロック（BEGIN:nextjs-agent-rules）と、feedback のブロック
 * - 旧版: codemod（npx @next/codemod agents-md）が入れる索引ブロック（NEXT-AGENTS-MD-START）
 */
const NEXT_AGENT_BLOCK = /NEXT-AGENTS-MD-(START|END)|(BEGIN|END):nextjs-agent-(rules|feedback)/

describe("AGENTS.md (#122)", () => {
  it("Next.js が書き足すブロック（現行のルール・feedback、旧版の索引）が入っていない", () => {
    for (const file of ["AGENTS.md", "CLAUDE.md"]) {
      const full = path.join(root, file)
      if (!existsSync(full)) continue
      expect(readFileSync(full, "utf-8"), `${file} に Next.js のブロックがある`).not.toMatch(NEXT_AGENT_BLOCK)
    }
  })

  it.each([
    ["<!-- BEGIN:nextjs-agent-rules -->"],
    ["<!-- END:nextjs-agent-rules -->"],
    ["<!-- BEGIN:nextjs-agent-feedback -->"],
    ["<!-- NEXT-AGENTS-MD-START -->"],
  ])("検出するマーカー: %s", (marker) => {
    expect(marker).toMatch(NEXT_AGENT_BLOCK)
  })

  it("next.config.ts で、next dev が AGENTS.md に書き足す動作（agentRules）を止めている", () => {
    const config = readFileSync(path.join(root, "next.config.ts"), "utf-8")
    expect(config).toMatch(/^\s*agentRules: false,/m)
  })
})
