// @vitest-environment node
import { describe, it, expect } from "vitest"
import { escapeHtml } from "../escape"
import { OTP_EXPIRES_MINUTES, renderOtpEmail } from "../otp"
import { renderNoticeEmail } from "../notice"
import type { EmailNotice } from "../../EmailSender"

const URL_PATTERN = /https?:\/\/|www\./i

describe("HTML のエスケープ", () => {
  it("& < > \" ' をエスケープする", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;")
  })
})

describe("OTP のメール", () => {
  it("件名と本文が日本語で、コードと有効期限を含む", () => {
    const mail = renderOtpEmail({ otp: "123456", type: "sign-in" })
    expect(mail.subject).toBe("【買い物メモ】ログインコード")
    expect(mail.text).toContain("123456")
    expect(mail.text).toContain(`${OTP_EXPIRES_MINUTES} 分`)
    expect(mail.text).toContain("心当たりがない場合")
    expect(mail.html).toContain("123456")
    expect(mail.html).toContain(`${OTP_EXPIRES_MINUTES} 分`)
  })

  it("件名にコードを入れない（通知のプレビューや転送で漏れにくくする）", () => {
    expect(renderOtpEmail({ otp: "123456", type: "sign-in" }).subject).not.toContain("123456")
  })

  it.each(["sign-in", "email-verification", "forget-password"] as const)(
    "type が %s でも URL を含まない",
    (type) => {
      const mail = renderOtpEmail({ otp: "000000", type })
      expect(mail.text).not.toMatch(URL_PATTERN)
      expect(mail.html).not.toMatch(URL_PATTERN)
      expect(mail.html).not.toMatch(/<a\s/i)
    }
  )

  it("確認用の type では件名を確認コードにする", () => {
    expect(renderOtpEmail({ otp: "123456", type: "email-verification" }).subject).toBe(
      "【買い物メモ】確認コード"
    )
  })

  it.each(["12345", "1234567", "12345a", "<b>1</b>", "", "１２３４５６"])(
    "6 桁の半角数字でないコード（%s）は拒否する",
    (otp) => {
      expect(() => renderOtpEmail({ otp, type: "sign-in" })).toThrow()
    }
  )
})

describe("通知のメール", () => {
  const notices: EmailNotice[] = [
    { kind: "passkey-added" },
    { kind: "passkey-removed" },
    { kind: "otp-locked" },
    { kind: "otp-alert", sentCount: 71, threshold: 70 },
  ]

  it.each(notices)("$kind の通知は件名と本文があり、URL を含まない", (notice) => {
    const mail = renderNoticeEmail(notice)
    expect(mail.subject).toMatch(/^【買い物メモ】/)
    expect(mail.text.length).toBeGreaterThan(0)
    expect(mail.text).not.toMatch(URL_PATTERN)
    expect(mail.html).not.toMatch(URL_PATTERN)
  })

  it("パスキーの追加の通知は、心当たりがなければすべての端末からログアウトするよう案内する", () => {
    const mail = renderNoticeEmail({ kind: "passkey-added", passkeyName: "iPhone" })
    expect(mail.subject).toBe("【買い物メモ】新しいパスキーが登録されました")
    expect(mail.text).toContain("iPhone")
    expect(mail.text).toContain("すべての端末からログアウト")
  })

  it("パスキーの削除の通知は、名前があれば本文に入れる", () => {
    const mail = renderNoticeEmail({ kind: "passkey-removed", passkeyName: "Pixel" })
    expect(mail.subject).toBe("【買い物メモ】パスキーが削除されました")
    expect(mail.text).toContain("Pixel")
  })

  it("パスキーの名前は HTML でエスケープし、件名には入れない", () => {
    const name = `<img src=x onerror="alert(1)">`
    const mail = renderNoticeEmail({ kind: "passkey-added", passkeyName: name })
    expect(mail.html).not.toContain("<img")
    expect(mail.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;")
    expect(mail.subject).not.toContain("img")
  })

  it("パスキーの名前の改行は空白にし、長すぎる名前は切り詰める", () => {
    const mail = renderNoticeEmail({ kind: "passkey-added", passkeyName: `a\r\nb${"x".repeat(200)}` })
    expect(mail.text).toContain("a b")
    expect(mail.text).not.toContain("x".repeat(65))
  })

  it("ロックの通知は、心当たりがなければ問題ないと伝える", () => {
    const mail = renderNoticeEmail({ kind: "otp-locked" })
    // specs（61-a3b「制限の通知と解除」）の文言
    expect(mail.text).toContain("ログインの試行が繰り返されたため、一時的に制限しました。心当たりがなければ問題ありません")
    expect(mail.text).toContain("心当たりがなければ問題ありません")
  })

  it("管理者のアラートは送信数としきい値を含む", () => {
    const mail = renderNoticeEmail({ kind: "otp-alert", sentCount: 71, threshold: 70 })
    expect(mail.text).toContain("71")
    expect(mail.text).toContain("70")
  })
})
