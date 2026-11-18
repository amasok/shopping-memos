// @vitest-environment node
import { describe, it, expect } from "vitest"
import { loginUrl, safeCallbackPath, withCallbackUrl } from "../callbackUrl"

const ORIGIN = "https://shopping.counoco.net"

describe("ログインの後の戻り先（#61 A3a 4.2）", () => {
  it("ログインの前にいた画面に戻る", () => {
    expect(safeCallbackPath("/lists/abc?tab=1#top", ORIGIN)).toBe("/lists/abc?tab=1#top")
    expect(safeCallbackPath("/settings", ORIGIN)).toBe("/settings")
    expect(safeCallbackPath(`${ORIGIN}/groups`, ORIGIN)).toBe("/groups")
  })

  it.each([
    "https://evil.example.com/",
    "//evil.example.com",
    "/\\evil.example.com",
    "\\\\evil.example.com",
    "/\tevil",
    "/foo\nbar",
    "javascript:alert(1)",
    "http://shopping.counoco.net/",
    "https://shopping.counoco.net.evil.example.com/",
    // ドットのセグメントが畳まれて "//evil.example" になるもの（レビューの High）
    "/.//evil.example",
    "/x/..//evil.example",
    "/%2e//evil.example",
    "/..//evil.example/x",
    "https://shopping.counoco.net/.//evil.example",
  ])("戻り先に別のサイトは指定できない（%s はホーム）", (value) => {
    expect(safeCallbackPath(value, ORIGIN)).toBe("/")
  })

  it.each([null, undefined, ""])("戻り先がない（%o）ときはホーム", (value) => {
    expect(safeCallbackPath(value, ORIGIN)).toBe("/")
  })

  it("ログイン画面には戻さない", () => {
    expect(safeCallbackPath("/login?callbackUrl=/x", ORIGIN)).toBe("/")
  })

  it("任意の画面の URL に、今いる画面を戻り先として付ける（#61 A4 の表示名の設定）", () => {
    expect(withCallbackUrl("/onboarding", "/groups")).toBe("/onboarding?callbackUrl=%2Fgroups")
    expect(withCallbackUrl("/onboarding", "/")).toBe("/onboarding")
  })

  it("ログイン画面の URL に、今いる画面を戻り先として付ける", () => {
    expect(loginUrl("/lists/abc?tab=1")).toBe("/login?callbackUrl=%2Flists%2Fabc%3Ftab%3D1")
    expect(loginUrl("/")).toBe("/login")
    expect(loginUrl("")).toBe("/login")
  })
})
