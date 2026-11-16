// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"

const unregisterAll = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/sw/kill-switch", () => ({
  unregisterAllServiceWorkers: () => unregisterAll(),
}))

import { SWKillSwitch } from "../SWKillSwitch"

describe("SWKillSwitch", () => {
  it("マウント時に全 SW の登録解除を呼ぶ", () => {
    render(<SWKillSwitch />)
    expect(unregisterAll).toHaveBeenCalledTimes(1)
  })
})
