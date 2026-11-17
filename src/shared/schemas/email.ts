import { z } from "./z"

/**
 * メールアドレスの正規化（#61。docs/features/passkey-email-auth.md の「## セキュリティ」）
 *
 * OTP の送信・照合と users.email の一意性は、すべて正規化の後の値で行う。
 * 順番は「Unicode 正規化（NFKC）→ trim・小文字化 → 形式の検証」。
 * ASCII 以外が残るアドレス（IDN を含む）は当面拒否する（ホモグリフで別人のアカウントに見せかけるのを防ぐ。#65）
 */

/** RFC 5321 の上限（パスの長さ 256 から <> を除いた 254） */
export const EMAIL_MAX_LENGTH = 254

const EMAIL_FORMAT_MESSAGE = "メールアドレスの形式が正しくありません"

// 印字できる ASCII だけ（空白・改行・制御文字を含まない）
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/

const formatSchema = z.email({ message: EMAIL_FORMAT_MESSAGE }).max(EMAIL_MAX_LENGTH, {
  message: EMAIL_FORMAT_MESSAGE,
})

function canonicalize(input: string): string {
  return input.normalize("NFKC").trim().toLowerCase()
}

/** 正規化したアドレスを返す。不正なら null */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null
  const value = canonicalize(input)
  if (!PRINTABLE_ASCII.test(value)) return null
  return formatSchema.safeParse(value).success ? value : null
}

/** 入力を正規化してから検証するスキーマ（フォームと API の入力に使う） */
export const emailSchema = z
  .string({ message: EMAIL_FORMAT_MESSAGE })
  .transform(canonicalize)
  .pipe(
    z
      .string()
      .regex(PRINTABLE_ASCII, { message: EMAIL_FORMAT_MESSAGE })
      .pipe(formatSchema)
  )
