import { getIPFromHeader } from "@better-auth/core/utils/ip"

/**
 * クライアントの IP のキー（#61 A3a 1.2。design の D4）
 *
 * - Vercel が設定する `x-real-ip` だけを使う。`x-forwarded-for`・`x-vercel-forwarded-for` は使わない
 *   （0.1 で確かめた。本番の前に Preview で、偽のヘッダが記録に入らないことを確かめる）
 * - IPv6 は /64 にまとめる。Better Auth の rate limit（`advanced.ipAddress`）と同じ関数で丸め、キーをそろえる
 * - 取れないとき（ローカル、値が IP でない、カンマ区切りの複数）は固定の 'unknown' にまとめる（制限を外さない）
 */

export const CLIENT_IP_HEADERS = ["x-real-ip"] as const
export const IPV6_SUBNET = 64
export const UNKNOWN_IP = "unknown"

export function clientIpKey(headers: Headers): string {
  for (const name of CLIENT_IP_HEADERS) {
    const value = headers.get(name)
    if (value) {
      const ip = getIPFromHeader(value, { ipv6Subnet: IPV6_SUBNET })
      if (ip) return ip
    }
  }
  return UNKNOWN_IP
}
