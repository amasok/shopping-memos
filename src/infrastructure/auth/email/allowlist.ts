import { normalizeEmail } from "@/shared/schemas/email"
import type { EmailSender } from "./EmailSender"

/**
 * 送信先の許可リスト（`EMAIL_RECIPIENT_ALLOWLIST`。Preview だけで設定する）
 *
 * Preview はだれでも開けるので、家族と開発者のアドレス以外には送らない（送信枠と送信元の評判を守る）。
 * リスト外のときも、呼び出し側には送ったのと同じに見せる（メールアドレスの列挙を防ぐ）。
 * 送らなかったことはログに出すが、宛先は出さない
 */
export function withRecipientAllowlist(
  sender: EmailSender,
  allowlist: ReadonlySet<string>,
  log: (message: string) => void = (message) => console.warn(message)
): EmailSender {
  const allowed = (to: string) => {
    const email = normalizeEmail(to)
    return email !== null && allowlist.has(email)
  }
  return {
    async sendOtp(input) {
      if (!allowed(input.to)) {
        log("[email] 許可リストにない宛先への OTP を送りませんでした")
        return
      }
      await sender.sendOtp(input)
    },
    async sendNotice(input) {
      if (!allowed(input.to)) {
        log(`[email] 許可リストにない宛先への通知（${input.notice.kind}）を送りませんでした`)
        return
      }
      await sender.sendNotice(input)
    },
  }
}
