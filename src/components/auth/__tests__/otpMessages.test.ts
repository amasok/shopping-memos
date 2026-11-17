// @vitest-environment node
import { describe, it, expect } from "vitest"
import { LOGIN_MESSAGES, otpErrorMessage } from "../otpMessages"

describe("ログイン画面のエラーの文言（#61 A3a 4.3）", () => {
  it.each([
    [{ status: 400, code: "INVALID_OTP" }, "コードが正しくありません"],
    [{ status: 400, code: "OTP_EXPIRED" }, "コードの有効期限が切れました。再送信してください"],
    [{ status: 403, code: "TOO_MANY_ATTEMPTS" }, "コードの有効期限が切れました。再送信してください"],
    [{ status: 403, code: "OTP_LOCKED" }, "しばらく時間をおいてからお試しください"],
    [{ status: 429, code: "RATE_LIMITED" }, "しばらく時間をおいてからお試しください"],
    [{ status: 429 }, "しばらく時間をおいてからお試しください"],
    [{ status: 403, code: "TURNSTILE_FAILED" }, LOGIN_MESSAGES.botCheckFailed],
    [{ status: 400, code: "INVALID_EMAIL" }, "メールアドレスの形式が正しくありません"],
    [{ status: 500 }, LOGIN_MESSAGES.unknown],
    [null, LOGIN_MESSAGES.unknown],
  ])("%o は「%s」", (error, message) => {
    expect(otpErrorMessage(error)).toBe(message)
  })

  it("どの文言にも登録の有無が分かる言葉はない", () => {
    for (const message of Object.values(LOGIN_MESSAGES)) {
      expect(message).not.toMatch(/未登録|登録されていない|存在しない|見つかりません/)
    }
  })
})
