/**
 * ログイン画面の文言（#61 A3a 4.3。specs の文言と design の「本体の実装」のエラーのコード）
 *
 * 登録の有無が分かる言葉（「未登録」など）は出さない
 */
export const LOGIN_MESSAGES = {
  offline: "オフラインのためログインできません",
  invalidOtp: "コードが正しくありません",
  expired: "コードの有効期限が切れました。再送信してください",
  rateLimited: "しばらく時間をおいてからお試しください",
  botCheckFailed: "確認に失敗しました。ページを読み込み直してから、もう一度お試しください",
  invalidEmail: "メールアドレスの形式が正しくありません",
  unknown: "エラーが発生しました。もう一度お試しください",
  migration: "ログイン方法が変わりました。以前 Google で使っていた Gmail のアドレスを入力してください",
} as const

export interface AuthErrorLike {
  status?: number
  code?: string
}

/** Better Auth のクライアントのエラー（status・code）を文言にする */
export function otpErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return LOGIN_MESSAGES.unknown
  switch (error.code) {
    case "INVALID_OTP":
      return LOGIN_MESSAGES.invalidOtp
    case "OTP_EXPIRED":
    case "TOO_MANY_ATTEMPTS":
      return LOGIN_MESSAGES.expired
    case "OTP_LOCKED":
    case "RATE_LIMITED":
      return LOGIN_MESSAGES.rateLimited
    case "TURNSTILE_FAILED":
      return LOGIN_MESSAGES.botCheckFailed
    case "INVALID_EMAIL":
      return LOGIN_MESSAGES.invalidEmail
  }
  if (error.status === 429) return LOGIN_MESSAGES.rateLimited
  return LOGIN_MESSAGES.unknown
}
