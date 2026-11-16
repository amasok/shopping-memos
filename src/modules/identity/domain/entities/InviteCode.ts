/**
 * グループ参加用の招待コード
 *
 * 総当たり対策（#67）:
 * - 暗号論的に安全な乱数で生成する（Math.random は使わない）
 * - 8 文字（31^8 ≒ 8.5 × 10^11 通り）
 * - 発行から 7 日で失効する
 * - 参加の試行はユーザーごとに 1 時間あたり 10 回まで
 */

/** 紛らわしい文字（0, O, I, L, 1）を除いた 31 文字 */
export const INVITE_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

export const INVITE_CODE_LENGTH = 8

/** 旧形式（6 文字）のコードも期限内は受け付ける */
export const INVITE_CODE_MIN_LENGTH = 6

export const INVITE_CODE_EXPIRY_DAYS = 7

export const INVITE_CODE_MAX_ATTEMPTS = 10

export const INVITE_CODE_ATTEMPT_WINDOW_MS = 60 * 60 * 1000

/**
 * 招待コードを生成する。
 * 256 を 31 で割った余りによる偏りを避けるため、248（= 31 × 8）以上のバイトは捨てる。
 */
export function generateInviteCode(
  getRandomValues: (array: Uint8Array) => Uint8Array = (a) => crypto.getRandomValues(a)
): string {
  const n = INVITE_CODE_CHARS.length
  const limit = 256 - (256 % n)
  let code = ""
  while (code.length < INVITE_CODE_LENGTH) {
    const bytes = getRandomValues(new Uint8Array(INVITE_CODE_LENGTH * 2))
    for (const b of bytes) {
      if (b >= limit) continue
      code += INVITE_CODE_CHARS[b % n]
      if (code.length === INVITE_CODE_LENGTH) break
    }
  }
  return code
}

/** 発行日時から有効期限を求める */
export function inviteCodeExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + INVITE_CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
}

export function isInviteCodeExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime()
}

/** 入力された招待コードを照合用に正規化する（前後の空白除去・大文字化） */
export function normalizeInviteCode(input: string): string {
  return input.trim().toUpperCase()
}
