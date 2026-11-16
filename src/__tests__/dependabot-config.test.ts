// @vitest-environment node
import { readFileSync } from "fs"
import path from "path"
import { parse } from "yaml"
import { describe, it, expect } from "vitest"

type Update = {
  "package-ecosystem": string
  directory: string
  "target-branch"?: string
  schedule: { interval: string }
  groups?: Record<string, { patterns?: string[]; "update-types"?: string[] }>
}

const config = parse(
  readFileSync(path.resolve(__dirname, "../../.github/dependabot.yml"), "utf-8")
) as { version: number; updates: Update[] }

describe("Dependabot の設定 (#73-6)", () => {
  it("npm と github-actions を対象にする", () => {
    expect(config.version).toBe(2)
    expect(config.updates.map((u) => u["package-ecosystem"]).sort()).toEqual(["github-actions", "npm"])
  })

  it.each(["npm", "github-actions"])("%s は月 1 回、develop に向けて、マイナー・パッチの更新を 1 本の PR にまとめる", (ecosystem) => {
    const update = config.updates.find((u) => u["package-ecosystem"] === ecosystem)!
    expect(update.directory).toBe("/")
    expect(update.schedule.interval).toBe("monthly")
    expect(update["target-branch"]).toBe("develop")
    const groups = Object.values(update.groups ?? {})
    expect(groups).toHaveLength(1)
    expect(groups[0].patterns).toEqual(["*"])
    // メジャーの更新はグループに入れず、個別の PR にする（壊れたときに切り分けて戻せるように）
    expect([...(groups[0]["update-types"] ?? [])].sort()).toEqual(["minor", "patch"])
  })
})
