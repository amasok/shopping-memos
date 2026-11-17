import type { OtpType } from "../EmailSender"
import { buildContent, type EmailContent } from "./layout"

/** OTP の有効期限（Better Auth の emailOTP の expiresIn: 300 と合わせる。A3） */
export const OTP_EXPIRES_MINUTES = 5

const OTP_PATTERN = /^\d{6}$/

const SUBJECTS: Record<OtpType, string> = {
  "sign-in": "ログインコード",
  "email-verification": "確認コード",
  "forget-password": "確認コード",
}

/**
 * OTP のメール（設計書「OTP メールテンプレート」）
 *
 * コードと有効期限だけを書き、リンクは入れない（フィッシングのメールと区別しやすくする）。
 * 件名にはコードを入れない（通知のプレビューに出さない）
 */
export function renderOtpEmail({ otp, type }: { otp: string; type: OtpType }): EmailContent {
  if (!OTP_PATTERN.test(otp)) {
    throw new Error("OTP は 6 桁の数字にしてください")
  }
  return buildContent(
    SUBJECTS[type],
    [
      "買い物メモのログイン画面に、次のコードを入力してください。",
      `有効期限は ${OTP_EXPIRES_MINUTES} 分です。コードはほかの人に教えないでください。`,
      "心当たりがない場合は、このメールを無視してください。コードを入力しなければ、ログインされることはありません。",
    ],
    otp
  )
}
