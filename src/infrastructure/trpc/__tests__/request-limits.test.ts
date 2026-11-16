// @vitest-environment node
import { describe, it, expect } from "vitest"
import { countBatchCalls, enforceRequestLimits } from "../request-limits"
import { REQUEST_LIMITS } from "@/shared/schemas/limits"

const ENDPOINT = "/api/trpc"
const limits = { batchSize: 3, bodyBytes: 100, mergeBodyBytes: 300 }

const url = (path: string) => `http://localhost${ENDPOINT}/${path}`

/** Content-Length を付けないストリームの本文 */
function streamOf(bytes: number): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent >= bytes) return controller.close()
      const size = Math.min(30, bytes - sent)
      sent += size
      controller.enqueue(new Uint8Array(size))
    },
  })
}

describe("countBatchCalls", () => {
  it("カンマ区切りのプロシージャを数える", () => {
    expect(countBatchCalls(new URL(url("items.list?batch=1")), ENDPOINT)).toBe(1)
    expect(countBatchCalls(new URL(url("items.list,tags.list,lists.list?batch=1")), ENDPOINT)).toBe(3)
  })

  it("エンコードされたカンマも数える", () => {
    expect(countBatchCalls(new URL(url("a%2Cb%2Cc?batch=1")), ENDPOINT)).toBe(3)
  })

  it("batch=1 がなくてもカンマ区切りなら数える", () => {
    expect(countBatchCalls(new URL(url("a,b,c,d")), ENDPOINT)).toBe(4)
  })

  it("不正なエンコードでも例外にしない", () => {
    expect(countBatchCalls(new URL(url("a%E0%A4%A,b")), ENDPOINT)).toBe(2)
  })
})

describe("enforceRequestLimits", () => {
  it("既定の上限はクライアントの maxItems と同じ値を使う", async () => {
    const path = Array.from({ length: REQUEST_LIMITS.batchSize + 1 }, (_, i) => `p${i}`).join(",")
    const result = await enforceRequestLimits(new Request(url(`${path}?batch=1`)), ENDPOINT)
    expect("response" in result && result.response.status).toBe(400)
  })

  it("バッチの呼び出し数が上限以内なら通す", async () => {
    const result = await enforceRequestLimits(new Request(url("a,b,c?batch=1")), ENDPOINT, limits)
    expect("request" in result).toBe(true)
  })

  it("バッチの呼び出し数が上限を超えたら 400", async () => {
    const result = await enforceRequestLimits(new Request(url("a,b,c,d?batch=1")), ENDPOINT, limits)
    expect("response" in result && result.response.status).toBe(400)
  })

  it("Content-Length が上限を超えたら本文を読まずに 413", async () => {
    const req = new Request(url("items.create"), {
      method: "POST",
      headers: { "content-length": "101" },
      body: "x".repeat(101),
    })
    const result = await enforceRequestLimits(req, ENDPOINT, limits)
    expect("response" in result && result.response.status).toBe(413)
  })

  it("Content-Length がなくても、読みながら上限を超えたら 413", async () => {
    const req = new Request(url("items.create"), {
      method: "POST",
      body: streamOf(200),
      // @ts-expect-error Node の fetch でストリームの本文を送るときに必要
      duplex: "half",
    })
    const result = await enforceRequestLimits(req, ENDPOINT, limits)
    expect("response" in result && result.response.status).toBe(413)
  })

  it("上限以内の本文は、そのまま読み直せるリクエストにして返す", async () => {
    const body = JSON.stringify({ "0": { json: { name: "牛乳" } } })
    const req = new Request(url("items.create?batch=1"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })
    const result = await enforceRequestLimits(req, ENDPOINT, limits)
    expect("request" in result).toBe(true)
    if ("request" in result) {
      expect(await result.request.text()).toBe(body)
      expect(result.request.method).toBe("POST")
      expect(result.request.headers.get("content-type")).toBe("application/json")
    }
  })

  it("sync.merge を単独で送るときは大きい上限を使う", async () => {
    const req = (bytes: number) =>
      new Request(url("sync.merge"), { method: "POST", body: "x".repeat(bytes) })
    const ok = await enforceRequestLimits(req(250), ENDPOINT, limits)
    expect("request" in ok).toBe(true)
    const ng = await enforceRequestLimits(req(301), ENDPOINT, limits)
    expect("response" in ng && ng.response.status).toBe(413)
  })

  it("sync.merge がバッチに混ざっていれば通常の上限を使う", async () => {
    const req = new Request(url("sync.merge,catalog.getItems?batch=1"), {
      method: "POST",
      body: "x".repeat(250),
    })
    const result = await enforceRequestLimits(req, ENDPOINT, limits)
    expect("response" in result && result.response.status).toBe(413)
  })

  it("既定の上限: 通常は 2MB、sync.merge 単独は 4MB（Vercel の 4.5MB より下）", () => {
    expect(REQUEST_LIMITS.bodyBytes).toBe(2 * 1024 * 1024)
    expect(REQUEST_LIMITS.mergeBodyBytes).toBe(4 * 1024 * 1024)
    expect(REQUEST_LIMITS.mergeBodyBytes).toBeLessThan(4.5 * 1024 * 1024)
  })

  it("GET は本文を読まずに通す", async () => {
    const req = new Request(url("items.list?batch=1&input=%7B%7D"))
    const result = await enforceRequestLimits(req, ENDPOINT, limits)
    expect("request" in result && result.request).toBe(req)
  })
})
