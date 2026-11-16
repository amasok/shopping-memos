import { lookup } from "dns/promises"
import { BlockList, isIP } from "net"

/**
 * SSRF 対策: 接続してよい URL・IP アドレスかを判定する。
 *
 * - IPv4 は特殊用途アドレス（IANA IPv4 Special-Purpose Address Registry）を拒否する
 * - IPv6 はグローバルユニキャスト（2000::/3）だけを許可し、その中の特殊用途帯も拒否する。
 *   ループバック・ULA（fc00::/7）・リンクローカル・マルチキャスト・IPv4 射影（::ffff:0:0/96）・
 *   NAT64（64:ff9b::/96）などは 2000::/3 の外なので、すべて拒否される
 */

const BLOCKED_IPV4_SUBNETS: ReadonlyArray<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local（クラウドのメタデータ 169.254.169.254 を含む）
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
]

const BLOCKED_IPV6_SUBNETS: ReadonlyArray<[string, number]> = [
  ["2001::", 23], // IETF protocol assignments（Teredo 2001::/32 を含む）
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4（内部の IPv4 を埋め込める）
  ["3fff::", 20], // documentation
]

const blockedV4 = new BlockList()
for (const [net, prefix] of BLOCKED_IPV4_SUBNETS) blockedV4.addSubnet(net, prefix, "ipv4")

const globalUnicastV6 = new BlockList()
globalUnicastV6.addSubnet("2000::", 3, "ipv6")

const blockedV6 = new BlockList()
for (const [net, prefix] of BLOCKED_IPV6_SUBNETS) blockedV6.addSubnet(net, prefix, "ipv6")

/** インターネット上の公開ユニキャストアドレスなら true */
export function isPublicIp(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return !blockedV4.check(ip, "ipv4")
  if (family === 6) {
    return globalUnicastV6.check(ip, "ipv6") && !blockedV6.check(ip, "ipv6")
  }
  return false
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])
// WHATWG URL はスキームの既定ポートを "" に正規化する
const ALLOWED_PORTS = new Set(["", "80", "443"])

export type UrlValidationError = "invalid_protocol" | "invalid_port" | "credentials_not_allowed"

/** スキーム・ポート・認証情報を検証する。問題なければ null */
export function validateTargetUrl(url: URL): UrlValidationError | null {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return "invalid_protocol"
  if (!ALLOWED_PORTS.has(url.port)) return "invalid_port"
  if (url.username !== "" || url.password !== "") return "credentials_not_allowed"
  return null
}

/** URL.hostname から接続先ホスト名を取り出す（IPv6 リテラルの [] を外す） */
export function toConnectHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname
}

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

export class HostResolutionError extends Error {
  constructor() {
    super("Failed to resolve hostname")
    this.name = "HostResolutionError"
  }
}

export class PrivateAddressError extends Error {
  constructor() {
    super("Private IP addresses are not allowed")
    this.name = "PrivateAddressError"
  }
}

/** IPv4 を先、IPv6 を後にする（同じファミリーの中では元の順を保つ） */
function preferIpv4(addresses: ResolvedAddress[]): ResolvedAddress[] {
  return [...addresses.filter((a) => a.family === 4), ...addresses.filter((a) => a.family === 6)]
}

/**
 * ホスト名を名前解決し、返ってきた全アドレスが公開アドレスであることを確認する。
 * 1 つでも非公開アドレスが含まれていれば拒否する（複数 A/AAAA レコードによる回避対策）。
 * 呼び出し側はここで返したアドレスにだけ接続し、再度の名前解決をしないこと（DNS リバインディング対策）。
 *
 * 検証した全アドレスを IPv4 を先にして返す。IPv6 で外に出られない環境（Vercel の Functions）でも、
 * AAAA を持つサイトに IPv4 で接続できるようにするため。先頭の 1 件だけに固定すると、
 * AAAA が先に返るサイト（Cloudflare 配下など）で接続に失敗していた
 */
export async function resolvePublicAddresses(hostname: string): Promise<ResolvedAddress[]> {
  const host = toConnectHost(hostname)

  const literalFamily = isIP(host)
  if (literalFamily !== 0) {
    if (!isPublicIp(host)) throw new PrivateAddressError()
    return [{ address: host, family: literalFamily as 4 | 6 }]
  }

  let results: { address: string; family: number }[]
  try {
    results = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new HostResolutionError()
  }
  if (!Array.isArray(results) || results.length === 0) throw new HostResolutionError()

  if (results.some((r) => !isPublicIp(r.address))) throw new PrivateAddressError()

  return preferIpv4(
    results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }))
  )
}
