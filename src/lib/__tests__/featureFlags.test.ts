import { describe, expect, it } from "vitest"
import { isLocalFirstEnabled } from "../featureFlags"

describe("isLocalFirstEnabled（NEXT_PUBLIC_LOCAL_FIRST）", () => {
  it('"true" のときだけ有効にする（未設定・ほかの値は従来のサーバーファースト）', () => {
    expect(isLocalFirstEnabled("true")).toBe(true)
    expect(isLocalFirstEnabled(undefined)).toBe(false)
    expect(isLocalFirstEnabled("false")).toBe(false)
    expect(isLocalFirstEnabled("1")).toBe(false)
  })
})
