// @vitest-environment node
import { readdirSync, readFileSync } from "fs"
import path from "path"
import { describe, it, expect } from "vitest"
import { globalConfig } from "zod/v4/core"
import { createItemSchema, syncMergeStrictInputSchema } from "../index"

/**
 * #71: Zod の JIT は z.object を作るときに `new Function("")` を試し、CSP の script-src eval 違反になる。
 * スキーマはクライアントでも読み込まれるので、JIT を止めておく
 */
describe("Zod の JIT を止める設定", () => {
  it("スキーマを読み込むと jitless が有効になっている", () => {
    expect(globalConfig.jitless).toBe(true)
  })

  it("jitless でもスキーマの検証は動く", () => {
    expect(createItemSchema.parse({ name: "牛乳" })).toMatchObject({ name: "牛乳", quantity: 1 })
    expect(createItemSchema.safeParse({ name: "" }).success).toBe(false)
    const empty = { items: [], tags: [], lists: [], listItems: [], history: [] }
    expect(syncMergeStrictInputSchema.safeParse({ data: empty }).success).toBe(true)
  })

  it("z.object を作るスキーマはすべて、zod より先に zod-config を import している", () => {
    const dir = path.resolve(__dirname, "..")
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "zod-config.ts")
    const withObjects = files.filter((f) => readFileSync(path.join(dir, f), "utf-8").includes("z.object("))
    expect(withObjects.length).toBeGreaterThan(0)
    for (const file of withObjects) {
      const source = readFileSync(path.join(dir, file), "utf-8")
      const config = source.indexOf('import "./zod-config"')
      const zod = source.indexOf('from "zod"')
      expect(config, `${file} に zod-config の import がない`).toBeGreaterThanOrEqual(0)
      expect(config, `${file} で zod-config が zod より後`).toBeLessThan(zod)
    }
  })
})
