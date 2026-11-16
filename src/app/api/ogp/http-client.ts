import http from "http"
import https from "https"
import type { IncomingMessage, RequestOptions } from "http"
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
 * 渡したアドレスは autoSelectFamily で順に試す（1 件目に接続できなければ次へ。IPv6 で外に出られない環境向け）。
 * Host ヘッダーと TLS の SNI・証明書検証は元のホスト名で行われる。
 * リダイレクトは追従しない（呼び出し側で 1 ホップずつ検証する）。
 */
export function requestPinned(
  url: URL,
  pinned: readonly ResolvedAddress[],
  options: PinnedRequestOptions
): Promise<IncomingMessage> {
  if (pinned.length === 0) return Promise.reject(new Error("No pinned address"))

  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) {
      callback(null, pinned.map(({ address, family }) => ({ address, family })))
    } else {
      callback(null, pinned[0].address, pinned[0].family)
    }
  }

  const client = url.protocol === "https:" ? https : http

  // autoSelectFamily は net.connect の指定。http.request はそのまま渡すが、@types/node の RequestOptions には無い
  const requestOptions: RequestOptions & { autoSelectFamily: boolean } = {
    protocol: url.protocol,
    hostname: toConnectHost(url.hostname),
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method: "GET",
    headers: options.headers,
    signal: options.signal,
    lookup: pinnedLookup,
    autoSelectFamily: true,
  }

  return new Promise((resolve, reject) => {
    const req = client.request(requestOptions, resolve)
    req.on("error", reject)
    req.end()
  })
}
