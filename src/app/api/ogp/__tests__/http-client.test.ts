// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach } from "vitest"
import http from "http"
import type { AddressInfo } from "net"

import { requestPinned } from "../http-client"

let server: http.Server
let port: number
let lastHost: string | undefined

beforeEach(async () => {
  lastHost = undefined
  server = http.createServer((req, res) => {
    lastHost = req.headers.host
    res.setHeader("content-type", "text/html")
    res.end("<title>pinned</title>")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe("requestPinned (#66)", () => {
  it("URLのホスト名を名前解決せず、渡された検証済みIPに接続し、Hostヘッダは元のホスト名にする", async () => {
    // pinned.invalid は名前解決できないホスト名。解決していれば ENOTFOUND になる
    const url = new URL(`http://pinned.invalid:${port}/path`)

    const res = await requestPinned(url, { address: "127.0.0.1", family: 4 }, {
      headers: {},
      signal: AbortSignal.timeout(5000),
    })
    res.resume()

    expect(res.statusCode).toBe(200)
    expect(lastHost).toBe(`pinned.invalid:${port}`)
  })

  it("リダイレクトは追従せず、3xx をそのまま返す", async () => {
    server.removeAllListeners("request")
    server.on("request", (_req, res) => {
      res.statusCode = 302
      res.setHeader("location", "http://127.0.0.1:1/")
      res.end()
    })
    const url = new URL(`http://pinned.invalid:${port}/`)

    const res = await requestPinned(url, { address: "127.0.0.1", family: 4 }, {
      headers: {},
      signal: AbortSignal.timeout(5000),
    })
    res.resume()

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe("http://127.0.0.1:1/")
  })

  it("中断シグナルで接続を止める", async () => {
    const controller = new AbortController()
    controller.abort()
    const url = new URL(`http://pinned.invalid:${port}/`)

    await expect(
      requestPinned(url, { address: "127.0.0.1", family: 4 }, { headers: {}, signal: controller.signal })
    ).rejects.toThrow()
  })
})
