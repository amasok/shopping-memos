// @vitest-environment node
import { describe, it, expect } from "vitest"
import { CLIENT_IP_HEADERS, IPV6_SUBNET, UNKNOWN_IP, clientIpKey } from "../ip"

function headers(init: Record<string, string>) {
  return new Headers(init)
}

describe("IP のキー（#61 A3a 1.2。design の D4）", () => {
  it("x-real-ip だけを使う", () => {
    expect(CLIENT_IP_HEADERS).toEqual(["x-real-ip"])
    expect(clientIpKey(headers({ "x-real-ip": "203.0.113.1" }))).toBe("203.0.113.1")
  })

  it("x-forwarded-for を変えても、キーは x-real-ip のまま（x-forwarded-for を変えても上限は変わらない）", () => {
    for (const forged of ["1.1.1.1", "8.8.8.8, 203.0.113.1", "10.0.0.1"]) {
      expect(clientIpKey(headers({ "x-real-ip": "203.0.113.1", "x-forwarded-for": forged }))).toBe("203.0.113.1")
    }
  })

  it("x-real-ip がなければ、x-forwarded-for・x-vercel-forwarded-for があっても 'unknown'", () => {
    expect(
      clientIpKey(headers({ "x-forwarded-for": "1.1.1.1", "x-vercel-forwarded-for": "2.2.2.2" }))
    ).toBe(UNKNOWN_IP)
  })

  it("同じ /64 の IPv6 は 1 つのキーにまとめる（同じ /64 の IPv6 は 1 つの IP として数える）", () => {
    expect(IPV6_SUBNET).toBe(64)
    const a = clientIpKey(headers({ "x-real-ip": "2001:db8:1:2::1" }))
    const b = clientIpKey(headers({ "x-real-ip": "2001:db8:1:2:ffff:ffff:ffff:ffff" }))
    const other = clientIpKey(headers({ "x-real-ip": "2001:db8:1:3::1" }))
    expect(a).toBe(b)
    expect(a).not.toBe(other)
  })

  it("大文字・省略の違う同じ IPv6 は同じキーになる", () => {
    expect(clientIpKey(headers({ "x-real-ip": "2001:DB8:0:0::1" }))).toBe(
      clientIpKey(headers({ "x-real-ip": "2001:db8::1" }))
    )
  })

  it("IPv4 を埋め込んだ IPv6 は IPv4 にする", () => {
    expect(clientIpKey(headers({ "x-real-ip": "::ffff:203.0.113.1" }))).toBe("203.0.113.1")
  })

  it.each(["", "not-an-ip", "203.0.113.1, 198.51.100.1", "999.1.1.1"])(
    "IP として読めない x-real-ip（%s）は 'unknown'（制限は外さない）",
    (value) => {
      expect(clientIpKey(headers({ "x-real-ip": value }))).toBe(UNKNOWN_IP)
    }
  )
})
