import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"

const createItem = vi.fn()

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }))
vi.mock("@/hooks/data", () => ({
  useGroups: () => ({ groups: [], isLoading: false }),
  useTags: () => ({ tags: [], isLoading: false }),
  useItemMutations: () => ({
    createItem: (...args: unknown[]) => createItem(...args),
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

describe("ItemForm 追加して続ける", () => {
  it("保存中に入力した次のアイテム名は、保存完了後のリセットで消えない（再発防止: #98）", async () => {
    let resolveSave!: () => void
    createItem.mockReturnValue(new Promise<void>((r) => (resolveSave = r)))
    render(<ItemForm onClose={vi.fn()} allowContinue />)

    const input = screen.getByTestId("item-name-input")
    fireEvent.change(input, { target: { value: "牛乳" } })
    fireEvent.click(screen.getByTestId("item-add-continue"))
    // 保存が終わる前に次の名前を入力する
    fireEvent.change(input, { target: { value: "パン" } })

    await act(async () => {
      resolveSave()
    })
    await waitFor(() => expect(createItem).toHaveBeenCalledTimes(1))
    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({ name: "牛乳" }))
    expect(screen.getByTestId("item-name-input")).toHaveValue("パン")
  })

  it("入力を変えていなければ、保存後にフォームをリセットする", async () => {
    createItem.mockReset()
    createItem.mockResolvedValue(undefined)
    render(<ItemForm onClose={vi.fn()} allowContinue />)

    fireEvent.change(screen.getByTestId("item-name-input"), { target: { value: "牛乳" } })
    fireEvent.click(screen.getByTestId("item-add-continue"))

    await waitFor(() => expect(screen.getByTestId("item-name-input")).toHaveValue(""))
  })
})
