import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }))
vi.mock("@/hooks/data", () => ({
  useGroups: () => ({ groups: [], isLoading: false }),
  useTags: () => ({ tags: [], isLoading: false }),
  useItemMutations: () => ({
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    isCreating: false,
    isUpdating: false,
    isDeleting: false,
  }),
  useTagMutations: () => ({ createTag: vi.fn() }),
}))
vi.mock("../OGPPreview", () => ({ OGPPreview: () => null }))

import { ItemForm } from "../ItemForm"
import { TEXT_LIMITS } from "@/shared/schemas/limits"
import type { ShoppingItem } from "@/lib/db"

const existing = (quantity: number): ShoppingItem => ({
  id: "item-1",
  name: "牛乳",
  quantity,
  tagIds: [],
  createdAt: new Date(),
  updatedAt: new Date(),
})

describe("ItemForm の入力上限 (#86)", () => {
  it("アイテム名とメモの入力欄に、サーバーと同じ maxLength が付く", () => {
    render(<ItemForm onClose={vi.fn()} />)

    expect(screen.getByTestId("item-name-input")).toHaveAttribute("maxLength", String(TEXT_LIMITS.itemName))
    expect(screen.getByTestId("item-memo-input")).toHaveAttribute("maxLength", String(TEXT_LIMITS.memo))
  })

  it("上限値はサーバー側の検証と同じ値を共有している（名前100・メモ2000・数量9999）", () => {
    expect(TEXT_LIMITS).toMatchObject({ itemName: 100, memo: 2000, quantityMax: 9999 })
  })

  it("数量は 9999 を超えて増やせない", () => {
    render(<ItemForm item={existing(9998)} onClose={vi.fn()} />)

    fireEvent.click(screen.getByTestId("quantity-increase"))
    expect(screen.getByTestId("quantity-display")).toHaveTextContent("9999")
    fireEvent.click(screen.getByTestId("quantity-increase"))
    fireEvent.click(screen.getByTestId("quantity-increase"))

    expect(screen.getByTestId("quantity-display")).toHaveTextContent("9999")
  })

  it("数量は 1 未満にならない", () => {
    render(<ItemForm onClose={vi.fn()} />)

    fireEvent.click(screen.getByTestId("quantity-decrease"))
    fireEvent.click(screen.getByTestId("quantity-decrease"))

    expect(screen.getByTestId("quantity-display")).toHaveTextContent("1")
  })
})
