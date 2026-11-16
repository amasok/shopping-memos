/**
 * 固定ウィンドウ方式の簡易レート制限（メモリ内）。
 *
 * これは補助的な目安にすぎない。主な防御は Vercel WAF の Rate Limiting ルールで行う。
 * サーバーレス環境（Fluid compute）ではインスタンスごとにカウントされ、負荷に応じてスケールアウトするため、
 * 実効上限は「limit × インスタンス数」となり厳密な上限にはならない。
 * 単一インスタンスに集中した連打を抑える程度の効果を想定している。
 */

interface Entry {
  count: number
  resetAt: number
}

export interface RateLimiterOptions {
  limit: number
  windowMs: number
  /** 保持するキー数の上限（メモリ使用量の上限） */
  maxKeys: number
}

export interface RateLimiter {
  /** 許可するなら true。呼ぶたびに 1 回分を消費する */
  consume(key: string, now?: number): boolean
  reset(): void
}

export function createRateLimiter({ limit, windowMs, maxKeys }: RateLimiterOptions): RateLimiter {
  const entries = new Map<string, Entry>()

  function evict(now: number) {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key)
    }
    // それでも多ければ古いキー（挿入順の先頭）から捨てる
    while (entries.size >= maxKeys) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  return {
    consume(key, now = Date.now()) {
      const entry = entries.get(key)
      if (!entry || entry.resetAt <= now) {
        if (!entry && entries.size >= maxKeys) evict(now)
        entries.delete(key)
        entries.set(key, { count: 1, resetAt: now + windowMs })
        return true
      }
      if (entry.count >= limit) return false
      entry.count++
      return true
    },
    reset() {
      entries.clear()
    },
  }
}

/** OGP 取得 API 用: 送信元 IP ごとに 1 分あたり 60 回まで */
export const ogpRateLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60_000,
  maxKeys: 10_000,
})

/**
 * 送信元 IP を取得する。Vercel は `x-real-ip` / `x-forwarded-for` を自身で設定する
 * （クライアントが送った値は上書きされる）。
 */
export function getClientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim()
  if (realIp) return realIp
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return forwarded || "unknown"
}
