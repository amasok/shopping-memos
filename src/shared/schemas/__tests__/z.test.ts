// @vitest-environment node
import { describe, it, expect } from "vitest"
import { z } from "../z"

describe("zod のラッパー（#71）", () => {
  it("ラッパー経由で使うと Zod の JIT（eval）が無効になっている", () => {
    expect(z.config().jitless).toBe(true)
    // jitless でも検証は動く
    const schema = z.object({ name: z.string().min(1) })
    expect(schema.safeParse({ name: "牛乳" }).success).toBe(true)
    expect(schema.safeParse({ name: "" }).success).toBe(false)
  })
})
