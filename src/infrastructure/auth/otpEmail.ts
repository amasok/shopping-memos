import { normalizeEmail } from "@/shared/schemas/email"

/**
 * OTP の送信・照合のリクエストの本文から、正規化したメールアドレスを取り出す（#61 A3a 1.4）
 *
 * hooks.before（2.2）で、Better Auth に渡す前・otp_events の HMAC の前にかける。
 * 正規化できないアドレス（ASCII 以外が残る・形式が違う）は null（呼ぶ側で 400 にする）
 */
export function readOtpEmail(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("email" in body)) return null
  return normalizeEmail((body as { email: unknown }).email)
}
