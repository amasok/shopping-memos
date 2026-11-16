// @vitest-environment node
import { describe, it, expect, vi } from "vitest"

const redirect = vi.fn()
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }))

import LegacyListPage from "../page"

describe("旧 URL /lists/[id]", () => {
  it("/lists/detail?id=<id> にリダイレクトする", async () => {
    await LegacyListPage({ params: Promise.resolve({ id: "abc" }) })
    expect(redirect).toHaveBeenCalledWith("/lists/detail?id=abc")
  })
})
