import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import superjson from "superjson"
import { useEffect } from "react"

import { TRPCProvider } from "../provider"
import { trpc } from "../client"
import { enforceRequestLimits } from "../request-limits"
import { REQUEST_LIMITS } from "@/shared/schemas/limits"

/**
 * #72: サーバーはバッチの呼び出し数を 10 件までに制限する。
 * クライアント（TRPCProvider の httpBatchLink）が上限に合わせて分割し、
 * 一画面で 10 件を超える呼び出しが同時に飛んでもエラーにならないことを確かめる
 */

const requested: Array<{ url: string; calls: number; batch: boolean; path: string }> = []

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost")
      const path = decodeURIComponent(url.pathname.slice("/api/trpc/".length))
      const calls = path.split(",").length
      const batch = url.searchParams.get("batch") === "1"
      requested.push({ url: url.href, calls, batch, path })
      const one = { result: { data: superjson.serialize([]) } }
      // バッチなら配列、単独（httpLink）ならオブジェクトで返す
      const body = batch ? Array.from({ length: calls }, () => one) : one
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
    })
  )
}

function FireMergeWithQueries({ onDone }: { onDone: () => void }) {
  const utils = trpc.useUtils()
  useEffect(() => {
    const empty = { items: [], tags: [], lists: [], listItems: [], history: [] }
    void Promise.all([
      utils.client.sync.merge.mutate({ data: empty }),
      ...Array.from({ length: 3 }, (_, i) =>
        utils.client.catalog.getItems.query({ searchText: `m${i}`, includePurchased: false })
      ),
    ]).then(onDone)
  }, [utils, onDone])
  return null
}

function FireQueries({ count, onDone }: { count: number; onDone: (n: number) => void }) {
  const utils = trpc.useUtils()
  useEffect(() => {
    // 同じ tick で一度に呼び出す（実際の画面で複数の hook が同時に呼ぶ状況）
    void Promise.all(
      Array.from({ length: count }, (_, i) =>
        utils.client.catalog.getItems.query({ searchText: `q${i}`, includePurchased: false })
      )
    ).then((r) => onDone(r.length))
  }, [utils, count, onDone])
  return null
}

beforeEach(() => {
  requested.length = 0
  stubFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("tRPC クライアントのバッチ分割 (#72)", () => {
  it("25 件の同時呼び出しを、1 回 10 件以内に分割して送り、すべて成功する", async () => {
    const done = vi.fn()
    render(
      <TRPCProvider>
        <FireQueries count={25} onDone={done} />
      </TRPCProvider>
    )

    await waitFor(() => expect(done).toHaveBeenCalledWith(25))
    expect(requested.reduce((sum, r) => sum + r.calls, 0)).toBe(25)
    expect(Math.max(...requested.map((r) => r.calls))).toBeLessThanOrEqual(REQUEST_LIMITS.batchSize)
    expect(requested.length).toBeGreaterThanOrEqual(3)
  })

  it("分割して送ったリクエストは、サーバー側のバッチ上限の検証をすべて通る", async () => {
    const done = vi.fn()
    render(
      <TRPCProvider>
        <FireQueries count={35} onDone={done} />
      </TRPCProvider>
    )
    await waitFor(() => expect(done).toHaveBeenCalledWith(35))

    for (const r of requested) {
      const checked = await enforceRequestLimits(new Request(r.url), "/api/trpc")
      expect("response" in checked, `${r.calls} 件のバッチ`).toBe(false)
    }
  })

  it("ちょうど 10 件なら 1 回にまとまる", async () => {
    const done = vi.fn()
    render(
      <TRPCProvider>
        <FireQueries count={10} onDone={done} />
      </TRPCProvider>
    )

    await waitFor(() => expect(done).toHaveBeenCalledWith(10))
    expect(requested).toHaveLength(1)
    expect(requested[0].calls).toBe(10)
  })

  it("sync.merge はバッチに混ぜず単独で送り、サーバーで大きい上限が使われる", async () => {
    const done = vi.fn()
    render(
      <TRPCProvider>
        <FireMergeWithQueries onDone={done} />
      </TRPCProvider>
    )
    await waitFor(() => expect(done).toHaveBeenCalled())

    const merge = requested.filter((r) => r.path.includes("sync.merge"))
    expect(merge).toHaveLength(1)
    expect(merge[0]).toMatchObject({ path: "sync.merge", calls: 1, batch: false })
    // ほかの呼び出しはバッチのまま
    expect(requested.filter((r) => !r.path.includes("sync.merge")).every((r) => r.batch)).toBe(true)
  })
})
