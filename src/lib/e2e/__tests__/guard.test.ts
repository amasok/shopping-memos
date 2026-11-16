// @vitest-environment node
import { existsSync, readFileSync } from "fs"
import path from "path"
import { describe, it, expect } from "vitest"
import {
  getPageExtensions,
  hasValidE2EToken,
  isE2EEmail,
  isE2ERequestAllowed,
  isE2ERuntimeEnabled,
} from "../guard"

const TOKEN = "a".repeat(64)
const enabledEnv = { E2E_TEST: "true", E2E_SEED_TOKEN: TOKEN }
const req = (token?: string) => ({
  headers: new Headers(token === undefined ? {} : { "x-e2e-token": token }),
})

describe("isE2ERuntimeEnabled", () => {
  it("E2E_TEST・トークンがそろい、Vercel の環境でなければ有効", () => {
    expect(isE2ERuntimeEnabled(enabledEnv)).toBe(true)
  })

  it("NODE_ENV=production でも条件がそろえば有効（オフライン E2E 用）", () => {
    expect(isE2ERuntimeEnabled({ ...enabledEnv, NODE_ENV: "production" })).toBe(true)
  })

  it("VERCEL_ENV=development（vercel dev）では有効", () => {
    expect(isE2ERuntimeEnabled({ ...enabledEnv, VERCEL_ENV: "development" })).toBe(true)
  })

  it.each([undefined, "", "false", "1", "TRUE"])("E2E_TEST=%s なら無効", (value) => {
    expect(isE2ERuntimeEnabled({ ...enabledEnv, E2E_TEST: value })).toBe(false)
  })

  it.each(["production", "preview", "unknown"])("VERCEL_ENV=%s なら無効", (value) => {
    expect(isE2ERuntimeEnabled({ ...enabledEnv, VERCEL_ENV: value })).toBe(false)
  })

  it("E2E_SEED_TOKEN が未設定・短すぎるなら無効", () => {
    expect(isE2ERuntimeEnabled({ E2E_TEST: "true" })).toBe(false)
    expect(isE2ERuntimeEnabled({ E2E_TEST: "true", E2E_SEED_TOKEN: "short" })).toBe(false)
  })
})

describe("hasValidE2EToken / isE2ERequestAllowed", () => {
  it("x-e2e-token が一致すれば許可する", () => {
    expect(hasValidE2EToken(req(TOKEN).headers, enabledEnv)).toBe(true)
    expect(isE2ERequestAllowed(req(TOKEN), enabledEnv)).toBe(true)
  })

  it("x-e2e-token がない・空・不一致なら拒否する", () => {
    expect(isE2ERequestAllowed(req(), enabledEnv)).toBe(false)
    expect(isE2ERequestAllowed(req(""), enabledEnv)).toBe(false)
    expect(isE2ERequestAllowed(req("b".repeat(64)), enabledEnv)).toBe(false)
    expect(isE2ERequestAllowed(req(TOKEN.slice(1)), enabledEnv)).toBe(false)
  })

  it("サーバー側のトークンが短ければ、ヘッダが一致しても拒否する", () => {
    expect(hasValidE2EToken(req("short").headers, { E2E_SEED_TOKEN: "short" })).toBe(false)
  })

  it("トークンが一致しても実行時の条件が欠ければ拒否する", () => {
    expect(isE2ERequestAllowed(req(TOKEN), { ...enabledEnv, E2E_TEST: undefined })).toBe(false)
    expect(isE2ERequestAllowed(req(TOKEN), { ...enabledEnv, VERCEL_ENV: "production" })).toBe(false)
    expect(isE2ERequestAllowed(req(TOKEN), { ...enabledEnv, VERCEL_ENV: "preview" })).toBe(false)
  })
})

describe("isE2EEmail", () => {
  it("@e2e-test.local のアドレスだけを E2E 用とみなす", () => {
    expect(isE2EEmail("user-a@e2e-test.local")).toBe(true)
    expect(isE2EEmail("User-A@E2E-Test.Local")).toBe(true)
    expect(isE2EEmail("user@example.com")).toBe(false)
    expect(isE2EEmail("user@e2e-test.local.example.com")).toBe(false)
    expect(isE2EEmail("@e2e-test.local")).toBe(false)
    expect(isE2EEmail(undefined)).toBe(false)
    expect(isE2EEmail(123)).toBe(false)
  })
})

describe("E2E 専用ルートのビルド時の除外", () => {
  it("E2E_BUILD が未設定なら pageExtensions に e2e.ts を含まない", () => {
    expect(getPageExtensions({})).toEqual(["tsx", "ts", "jsx", "js"])
    expect(getPageExtensions({ E2E_BUILD: "false" })).not.toContain("e2e.ts")
    expect(getPageExtensions({ E2E_TEST: "true" })).not.toContain("e2e.ts")
  })

  it("E2E_BUILD=true なら e2e.ts を加える", () => {
    expect(getPageExtensions({ E2E_BUILD: "true" })).toEqual(["tsx", "ts", "jsx", "js", "e2e.ts"])
  })

  const root = path.resolve(__dirname, "../../../..")

  it("seed API は route.e2e.ts にあり、通常の route.ts は存在しない", () => {
    expect(existsSync(path.join(root, "src/app/api/e2e/seed/route.e2e.ts"))).toBe(true)
    expect(existsSync(path.join(root, "src/app/api/e2e/seed/route.ts"))).toBe(false)
  })

  it("next.config.ts が pageExtensions と E2E_BUILD の埋め込みを設定している", () => {
    const config = readFileSync(path.join(root, "next.config.ts"), "utf-8")
    expect(config).toContain("pageExtensions: getPageExtensions()")
    expect(config).toContain('E2E_BUILD: process.env.E2E_BUILD === "true" ? "true" : "false"')
  })
})
