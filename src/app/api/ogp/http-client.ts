import http from "http"
import https from "https"
import type { IncomingMessage } from "http"
import type { LookupFunction } from "net"
import { toConnectHost, type ResolvedAddress } from "./ssrf"

export interface PinnedRequestOptions {
  headers: Record<string, string>
  signal: AbortSignal
}

/**
 * 検証済みの IP アドレスに固定して GET する。
 *
 * `fetch` は接続時に改めて名前解決するため、検証時と接続時で IP が変わり得る（DNS リバインディング）。
 * ここでは `lookup` を差し替えて名前解決を行わせず、渡されたアドレスにだけ接続する。
 * Host ヘッダーと TLS の SNI・証明書検証は元のホスト名で行われる。
 * リダイレクトは追従しない（呼び出し側で 1 ホップずつ検証する）。
 */
export function requestPinned(
  url: URL,
  pinned: ResolvedAddress,
  options: PinnedRequestOptions
): Promise<IncomingMessage> {
  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }])
    } else {
      callback(null, pinned.address, pinned.family)
    }
  }

  const client = url.protocol === "https:" ? https : http

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: toConnectHost(url.hostname),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: options.headers,
        signal: options.signal,
        lookup: pinnedLookup,
      },
      resolve
    )
    req.on("error", reject)
    req.end()
  })
}
