import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }))
vi.mock("dns/promises", () => ({ default: { lookup: mockLookup }, lookup: mockLookup }))

import {
  isPublicIp,
  validateTargetUrl,
  resolvePublicAddress,
  toConnectHost,
  HostResolutionError,
  PrivateAddressError,
} from "../ssrf"

beforeEach(() => {
  mockLookup.mockReset()
})

describe("isPublicIp", () => {
  it.each([
    ["0.0.0.0", "0.0.0.0/8"],
    ["0.1.2.3", "0.0.0.0/8"],
    ["10.0.0.1", "プライベート"],
    ["100.64.0.1", "CGNAT 100.64/10"],
    ["100.127.255.254", "CGNAT 100.64/10 の末尾"],
    ["127.0.0.1", "ループバック"],
    ["169.254.169.254", "クラウドのメタデータ"],
    ["172.16.0.1", "プライベート"],
    ["172.31.255.255", "プライベート"],
    ["192.168.1.1", "プライベート"],
    ["198.18.0.1", "ベンチマーク 198.18/15"],
    ["198.19.255.255", "ベンチマーク 198.18/15 の末尾"],
    ["224.0.0.1", "マルチキャスト"],
    ["239.255.255.250", "マルチキャスト"],
    ["240.0.0.1", "予約済み"],
    ["255.255.255.255", "ブロードキャスト"],
    ["::", "未指定アドレス"],
    ["::1", "IPv6 ループバック"],
    ["fd00::1", "ULA fd00::/8"],
    ["fc00::1", "ULA fc00::/7"],
    ["fe80::1", "IPv6 リンクローカル"],
    ["::ffff:127.0.0.1", "IPv4 射影のループバック"],
    ["::ffff:169.254.169.254", "IPv4 射影のメタデータ"],
    ["::ffff:8.8.8.8", "IPv4 射影は公開アドレスでも拒否"],
    ["64:ff9b::7f00:1", "NAT64"],
    ["ff02::1", "IPv6 マルチキャスト"],
    ["2002:7f00:1::1", "6to4（127.0.0.1 を埋め込める）"],
    ["2001::1", "Teredo"],
    ["2001:db8::1", "ドキュメント用"],
  ])("%s（%s）は非公開として拒否する", (ip) => {
    expect(isPublicIp(ip)).toBe(false)
  })

  it.each([
    ["8.8.8.8"],
    ["1.1.1.1"],
    ["93.184.216.34"],
    ["172.15.255.255"],
    ["172.32.0.1"],
    ["100.63.255.255"],
    ["100.128.0.1"],
    ["198.17.255.255"],
    ["198.20.0.1"],
    ["223.255.255.255"],
    ["2606:4700:4700::1111"],
    ["2a00:1450:4001:81b::200e"],
  ])("%s は公開アドレスとして許可する", (ip) => {
    expect(isPublicIp(ip)).toBe(true)
  })

  it("IP として解釈できない文字列は拒否する", () => {
    expect(isPublicIp("example.com")).toBe(false)
    expect(isPublicIp("")).toBe(false)
    expect(isPublicIp("999.1.1.1")).toBe(false)
    expect(isPublicIp("[::1]")).toBe(false)
  })
})

describe("validateTargetUrl", () => {
  it("http / https の既定ポートは許可する", () => {
    expect(validateTargetUrl(new URL("http://example.com/"))).toBeNull()
    expect(validateTargetUrl(new URL("https://example.com/"))).toBeNull()
  })

  it("明示された 80 / 443 は許可する", () => {
    expect(validateTargetUrl(new URL("http://example.com:80/"))).toBeNull()
    expect(validateTargetUrl(new URL("https://example.com:443/"))).toBeNull()
  })

  it("スキームと異なる 80 / 443 も許可する（ポートの許可リストは 80 と 443 のみ）", () => {
    expect(validateTargetUrl(new URL("http://example.com:443/"))).toBeNull()
    expect(validateTargetUrl(new URL("https://example.com:80/"))).toBeNull()
  })

  it.each([["ftp://example.com/"], ["file:///etc/passwd"], ["gopher://example.com/"], ["javascript:alert(1)"]])(
    "%s は invalid_protocol",
    (url) => {
      expect(validateTargetUrl(new URL(url))).toBe("invalid_protocol")
    }
  )

  it.each([
    ["http://example.com:8080/"],
    ["https://example.com:8443/"],
    ["http://127.0.0.1:22/"],
    ["http://example.com:6379/"],
  ])("%s は invalid_port", (url) => {
    expect(validateTargetUrl(new URL(url))).toBe("invalid_port")
  })

  it("user:pass@ を含む URL は拒否する", () => {
    expect(validateTargetUrl(new URL("http://user:pass@example.com/"))).toBe("credentials_not_allowed")
    expect(validateTargetUrl(new URL("http://user@example.com/"))).toBe("credentials_not_allowed")
    expect(validateTargetUrl(new URL("https://:pass@example.com/"))).toBe("credentials_not_allowed")
  })
})

describe("toConnectHost", () => {
  it("IPv6 リテラルの角括弧を外す", () => {
    expect(toConnectHost("[::1]")).toBe("::1")
  })

  it("通常のホスト名はそのまま返す", () => {
    expect(toConnectHost("example.com")).toBe("example.com")
  })
})

describe("resolvePublicAddress", () => {
  it("公開アドレスに解決されたら先頭のアドレスを返す", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }])

    await expect(resolvePublicAddress("example.com")).resolves.toEqual({ address: "93.184.216.34", family: 4 })
    expect(mockLookup).toHaveBeenCalledWith("example.com", { all: true, verbatim: true })
  })

  it("IPv6 の公開アドレスは family 6 で返す", async () => {
    mockLookup.mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }])

    await expect(resolvePublicAddress("example.com")).resolves.toEqual({ address: "2606:4700:4700::1111", family: 6 })
  })

  it("複数レコードのうち 1 件でもプライベートなら拒否する", async () => {
    mockLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ])

    await expect(resolvePublicAddress("rebind.example")).rejects.toBeInstanceOf(PrivateAddressError)
  })

  it("非公開アドレスが先頭でも、後ろにあっても拒否する", async () => {
    mockLookup.mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(resolvePublicAddress("rebind.example")).rejects.toBeInstanceOf(PrivateAddressError)
  })

  it("IPv4 のプライベートと IPv6 の公開が混在していても拒否する", async () => {
    mockLookup.mockResolvedValue([
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "169.254.169.254", family: 4 },
    ])

    await expect(resolvePublicAddress("mixed.example")).rejects.toBeInstanceOf(PrivateAddressError)
  })

  it("名前解決に失敗したら HostResolutionError", async () => {
    mockLookup.mockRejectedValue(new Error("ENOTFOUND"))

    await expect(resolvePublicAddress("nope.example")).rejects.toBeInstanceOf(HostResolutionError)
  })

  it("レコードが 0 件なら HostResolutionError", async () => {
    mockLookup.mockResolvedValue([])

    await expect(resolvePublicAddress("empty.example")).rejects.toBeInstanceOf(HostResolutionError)
  })

  it("IP リテラルは名前解決せずに判定する（公開アドレス）", async () => {
    await expect(resolvePublicAddress("93.184.216.34")).resolves.toEqual({ address: "93.184.216.34", family: 4 })
    expect(mockLookup).not.toHaveBeenCalled()
  })

  it.each([["127.0.0.1"], ["169.254.169.254"], ["[::1]"], ["[::ffff:127.0.0.1]"], ["0.0.0.0"]])(
    "IP リテラル %s は名前解決せずに拒否する",
    async (host) => {
      await expect(resolvePublicAddress(host)).rejects.toBeInstanceOf(PrivateAddressError)
      expect(mockLookup).not.toHaveBeenCalled()
    }
  )
})
