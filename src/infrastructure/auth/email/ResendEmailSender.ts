import { normalizeEmail } from "@/shared/schemas/email"
import {
  EmailSendError,
  type EmailSender,
  type SendNoticeInput,
  type SendOtpInput,
} from "./EmailSender"
import type { EmailContent } from "./templates/layout"
import { renderNoticeEmail } from "./templates/notice"
import { renderOtpEmail } from "./templates/otp"

export const RESEND_API_URL = "https://api.resend.com/emails"
const TIMEOUT_MS = 10_000

export interface ResendEmailSenderOptions {
  apiKey: string
  /** 送信元（例: `買い物メモ <noreply@mail.counoco.net>`）。Resend で検証したドメインにする */
  from: string
  /** テストで差し替える */
  fetch?: typeof fetch
}

/**
 * Resend で送る（本番・Preview）
 *
 * SDK（resend パッケージ）は使わず、メールを 1 通送る REST API を fetch で呼ぶ。
 * 失敗は EmailSendError で投げる（API キー・本文・コードをメッセージに入れない）
 */
export class ResendEmailSender implements EmailSender {
  private readonly apiKey: string
  private readonly from: string
  private readonly fetchImpl: typeof fetch

  constructor({ apiKey, from, fetch: fetchImpl }: ResendEmailSenderOptions) {
    if (!apiKey) throw new Error("RESEND_API_KEY がありません")
    if (!from) throw new Error("EMAIL_FROM がありません")
    this.apiKey = apiKey
    this.from = from
    this.fetchImpl = fetchImpl ?? fetch
  }

  async sendOtp({ to, otp, type }: SendOtpInput): Promise<void> {
    await this.send(to, renderOtpEmail({ otp, type }))
  }

  async sendNotice({ to, notice }: SendNoticeInput): Promise<void> {
    await this.send(to, renderNoticeEmail(notice))
  }

  private async send(to: string, content: EmailContent): Promise<void> {
    // 呼び出し側で正規化した値だけを受け付ける（改行などの混入を送信の直前でも止める）
    if (normalizeEmail(to) !== to) {
      throw new EmailSendError("宛先のメールアドレスが正しくありません")
    }

    let response: Response
    try {
      response = await this.fetchImpl(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [to],
          subject: content.subject,
          text: content.text,
          html: content.html,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new EmailSendError("メールの送信サービスに接続できませんでした")
    }

    if (!response.ok) {
      // 応答の本文は読まない（キーや宛先が含まれることがあるため）
      throw new EmailSendError(`メールの送信に失敗しました（HTTP ${response.status}）`, response.status)
    }
  }
}
