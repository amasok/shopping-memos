import { describe, it, expect } from "vitest"
import { TURNSTILE_TEST_SITE_KEY, usesDummyTurnstile } from "../useTurnstile"

describe("非表示の Turnstile（#61 A3a 4.3）", () => {
  it("E2E のビルドでテスト用のサイトキーのときだけ、スクリプトを読まずにダミーのトークンを使う", () => {
    expect(usesDummyTurnstile(TURNSTILE_TEST_SITE_KEY, true)).toBe(true)
    expect(usesDummyTurnstile(TURNSTILE_TEST_SITE_KEY, false)).toBe(false)
    expect(usesDummyTurnstile("0x4AAAAAAA-real-site", true)).toBe(false)
  })
})
