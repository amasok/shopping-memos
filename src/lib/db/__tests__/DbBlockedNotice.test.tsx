import { act, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ blocked: false, listeners: new Set<() => void>() }))

vi.mock("../versionEvents", () => ({
  attachVersionHandlers: () => {},
  isDbBlocked: () => state.blocked,
  subscribeDbBlocked: (listener: () => void) => {
    state.listeners.add(listener)
    return () => state.listeners.delete(listener)
  },
}))

import { DbBlockedNotice } from "../provider"

function setBlocked(value: boolean) {
  state.blocked = value
  act(() => state.listeners.forEach((l) => l()))
}

describe("DbBlockedNotice", () => {
  beforeEach(() => {
    state.blocked = false
  })

  it("古いタブが DB の更新を止めている間だけ、ほかのタブを閉じる案内を出す", () => {
    render(<DbBlockedNotice />)
    expect(screen.queryByTestId("db-blocked-notice")).toBeNull()

    setBlocked(true)
    expect(screen.getByRole("alert")).toHaveTextContent("ほかのタブを閉じてください")

    setBlocked(false)
    expect(screen.queryByTestId("db-blocked-notice")).toBeNull()
  })
})
