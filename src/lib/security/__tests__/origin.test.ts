// @vitest-environment node
import { describe, it, expect } from "vitest"
import { isSameOriginRequest } from "../origin"

const APP = ["https://shopping.counoco.net", "https://preview-shopping-memos.vercel.app"]

function req(headers: Record<string, string>) {
  return new Request("https://shopping.counoco.net/api/trpc/x", { method: "POST", headers })
}

describe("別のオリジンからの POST を断る（#61 A3a 3.1。design の D6）", () => {
  it("同じオリジンなら通す", () => {
    expect(isSameOriginRequest(req({ origin: "https://shopping.counoco.net" }), APP)).toBe(true)
  })

  it("信頼するオリジン（Preview）なら通す", () => {
    expect(isSameOriginRequest(req({ origin: "https://preview-shopping-memos.vercel.app" }), APP)).toBe(true)
  })

  it.each([
    "https://evil.example.com",
    "http://shopping.counoco.net",
    "https://shopping.counoco.net:8443",
    "https://shopping.counoco.net.evil.example.com",
  ])("Origin が違う（%s）と断る", (origin) => {
    expect(isSameOriginRequest(req({ origin }), APP)).toBe(false)
  })

  it("Origin が null だと断る", () => {
    expect(isSameOriginRequest(req({ origin: "null" }), APP)).toBe(false)
  })

  it("Sec-Fetch-Site が cross-site だと、Origin がなくても断る", () => {
    expect(isSameOriginRequest(req({ "sec-fetch-site": "cross-site" }), APP)).toBe(false)
  })

  it("Sec-Fetch-Site が cross-site なら、Origin が同じでも断る", () => {
    expect(
      isSameOriginRequest(req({ origin: "https://shopping.counoco.net", "sec-fetch-site": "cross-site" }), APP)
    ).toBe(false)
  })

  it.each(["same-origin", "same-site", "none"])("Sec-Fetch-Site が %s で Origin がなければ通す", (site) => {
    expect(isSameOriginRequest(req({ "sec-fetch-site": site }), APP)).toBe(true)
  })

  it("Origin も Sec-Fetch-Site もなければ通す（ブラウザ以外。Cookie を持たないので CSRF にならない）", () => {
    expect(isSameOriginRequest(req({}), APP)).toBe(true)
  })

  it("信頼するオリジンの末尾の / や大文字の違いは同じに扱う", () => {
    expect(isSameOriginRequest(req({ origin: "https://Shopping.Counoco.net" }), ["https://shopping.counoco.net/"])).toBe(true)
  })
})
