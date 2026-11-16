import { describe, it, expect } from "vitest"
import { listDetailHref } from "../routes"

describe("listDetailHref", () => {
  it("/lists/detail?id=<id> を返す", () => {
    expect(listDetailHref("abc-123")).toBe("/lists/detail?id=abc-123")
  })
  it("ID を URL エンコードする", () => {
    expect(listDetailHref("a b&c")).toBe("/lists/detail?id=a%20b%26c")
  })
})
