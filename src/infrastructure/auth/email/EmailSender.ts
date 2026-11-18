/**
 * メールの送信（#61 A1。docs/features/passkey-email-auth.md の「### 3. メール送信サービス」）
 *
 * 送信サービス（Resend）から切り離し、開発・E2E では差し替える。
 * 実装: ResendEmailSender / ConsoleEmailSender / TestMailboxEmailSender。選び方は createEmailSender（index.ts）
 */

/** Better Auth の emailOTP の sendVerificationOTP が渡す type */
export type OtpType = "sign-in" | "email-verification" | "forget-password"

/** OTP 以外の通知 */
export type EmailNotice =
  /** パスキーが登録された（name は利用者が付けた名前。なければ省略） */
  | { kind: "passkey-added"; passkeyName?: string }
  /** パスキーが削除された */
  | { kind: "passkey-removed"; passkeyName?: string }
  /** OTP のログインを一時的に制限した（ロック・チャレンジ必須の段階に入った） */
  | { kind: "otp-locked" }
  /** 管理者向け: 1 日の送信数がしきい値を超えた */
  | { kind: "otp-alert"; sentCount: number; threshold: number }

export interface SendOtpInput {
  /** 正規化済みのアドレス（normalizeEmail を通したもの） */
  to: string
  /** 6 桁の数字 */
  otp: string
  type: OtpType
}

export interface SendNoticeInput {
  to: string
  notice: EmailNotice
}

export interface EmailSender {
  sendOtp(input: SendOtpInput): Promise<void>
  sendNotice(input: SendNoticeInput): Promise<void>
}

/** 送信サービスへの送信に失敗した。API キー・本文・コードはメッセージに含めない */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = "EmailSendError"
  }
}
