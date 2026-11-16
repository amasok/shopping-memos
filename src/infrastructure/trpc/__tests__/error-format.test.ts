// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest"
import { TRPCError } from "@trpc/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { z } from "@/shared/schemas/z"

vi.mock("@/infrastructure/auth", () => ({ auth: vi.fn(async () => null) }))

import { router, publicProcedure } from "../server"
import { INTERNAL_ERROR_MESSAGE, formatErrorShape } from "../error-format"

const LEAKY = 'Failed query: select "groups"."invite_code_expires_at" from "groups" params: user-123'

/** 実際の tRPC の初期化（server.ts の errorFormatter）を通すための小さなルーター */
const testRouter = router({
  dbError: publicProcedure.query(() => {
    throw new Error(LEAKY)
  }),
  wrappedDbError: publicProcedure.query(() => {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: new Error(LEAKY) })
  }),
  notFound: publicProcedure.query(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "リストが見つかりません" })
  }),
  badRequest: publicProcedure.input(z.object({ name: z.string().min(1) })).mutation(() => "ok"),
})

async function call(path: string, init?: RequestInit) {
  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request(`http://localhost/api/trpc/${path}`, init),
    router: testRouter,
    createContext: () => ({ userId: null }) as never,
  })
  const body = await res.json()
  return { status: res.status, error: body.error.json as { message: string; data: Record<string, unknown> } }
}

afterEach(() => vi.unstubAllEnvs())

describe("tRPC のエラー応答（本番）(#135)", () => {
  it("DB のエラーなど予期しないエラーは、メッセージを汎用の文言にし、stack を返さない", async () => {
    vi.stubEnv("NODE_ENV", "production")
    for (const path of ["dbError", "wrappedDbError"]) {
      const { status, error } = await call(path)
      expect(status).toBe(500)
      expect(error.message).toBe(INTERNAL_ERROR_MESSAGE)
      expect(JSON.stringify(error)).not.toContain("Failed query")
      expect(JSON.stringify(error)).not.toContain("user-123")
      expect(error.data.stack).toBeUndefined()
      expect(error.data.code).toBe("INTERNAL_SERVER_ERROR")
    }
  })

  it("意図して投げた TRPCError（NOT_FOUND）のメッセージはそのまま返す", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const { status, error } = await call("notFound")
    expect(status).toBe(404)
    expect(error.message).toBe("リストが見つかりません")
    expect(error.data.stack).toBeUndefined()
  })

  it("入力の検証エラー（BAD_REQUEST）はマスクしない", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const { status, error } = await call("badRequest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: { name: "" } }),
    })
    expect(status).toBe(400)
    expect(error.message).not.toBe(INTERNAL_ERROR_MESSAGE)
    expect(error.data.code).toBe("BAD_REQUEST")
  })

  it("開発中は、調査のためにメッセージをそのまま返す", async () => {
    vi.stubEnv("NODE_ENV", "development")
    const { error } = await call("dbError")
    expect(error.message).toBe(LEAKY)
  })
})

describe("formatErrorShape (#135)", () => {
  const shape = () => ({ message: LEAKY, code: -32603, data: { code: "INTERNAL_SERVER_ERROR", stack: "at x" } })

  it("本番では INTERNAL_SERVER_ERROR のメッセージを差し替え、stack を消す（元の shape は変えない）", () => {
    const original = shape()
    const formatted = formatErrorShape(original, { code: "INTERNAL_SERVER_ERROR" }, { isProduction: true })
    expect(formatted.message).toBe(INTERNAL_ERROR_MESSAGE)
    expect(formatted.data).toEqual({ code: "INTERNAL_SERVER_ERROR" })
    expect(original.message).toBe(LEAKY)
    expect(original.data.stack).toBe("at x")
  })

  it.each(["BAD_REQUEST", "NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED", "CONFLICT"] as const)(
    "本番でも %s のメッセージは残す（stack は消す）",
    (code) => {
      const formatted = formatErrorShape({ message: "見せてよい文言", data: { stack: "at x" } }, { code }, { isProduction: true })
      expect(formatted.message).toBe("見せてよい文言")
      expect(formatted.data.stack).toBeUndefined()
    }
  )

  it("本番でなければ何も変えない", () => {
    const original = shape()
    expect(formatErrorShape(original, { code: "INTERNAL_SERVER_ERROR" }, { isProduction: false })).toBe(original)
  })
})
