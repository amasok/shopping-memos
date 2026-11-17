import type { EmailSender, SendNoticeInput, SendOtpInput } from "./EmailSender"
import { renderNoticeEmail } from "./templates/notice"
import { renderOtpEmail } from "./templates/otp"

export interface ConsoleEmailSenderOptions {
  log?: (message: string) => void
}

/**
 * サーバーのログに出す（ローカルの `next dev` 用）
 *
 * コードをログに出すので、本番・Vercel では使わない（createEmailSender が選ばない）
 */
export class ConsoleEmailSender implements EmailSender {
  private readonly log: (message: string) => void

  constructor({ log }: ConsoleEmailSenderOptions = {}) {
    this.log = log ?? ((message) => console.info(message))
  }

  async sendOtp({ to, otp, type }: SendOtpInput): Promise<void> {
    // 文面の検証（コードの形式）は本物の送信と同じく通す
    renderOtpEmail({ otp, type })
    this.log(`[email:console] ${to} への OTP（${type}）: ${otp}`)
  }

  async sendNotice({ to, notice }: SendNoticeInput): Promise<void> {
    this.log(`[email:console] ${to} への通知: ${renderNoticeEmail(notice).subject}`)
  }
}
