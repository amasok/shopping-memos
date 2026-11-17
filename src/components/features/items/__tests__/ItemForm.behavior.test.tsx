import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => ({
  user: null as null | { id: string },
  groups: [] as { id: string; name: string }[],
  tags: [] as { id: string; name: string; groupId?: string }[],
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  createTag: vi.fn(),
  tagsLoading: false,
  groupsLoading: false,
  processing: false,
  lastTagsArg: undefined as unknown,
}))

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: h.user }) }))
vi.mock("@/hooks/data", () => ({
  useGroups: () => ({ groups: h.groups, isLoading: h.groupsLoading }),
  useTags: (arg: unknown) => {
    h.lastTagsArg = arg
    return { tags: h.tags, isLoading: h.tagsLoading }
  },
  useItemMutations: () => ({
    createItem: h.createItem,
    updateItem: h.updateItem,
    deleteItem: h.deleteItem,
    isCreating: h.processing,
    isUpdating: false,
    isDeleting: false,
  }),
  useTagMutations: () => ({ createTag: h.createTag }),
}))
vi.mock("../OGPPreview", () => ({ OGPPreview: ({ url }: { url: string }) => <div data-testid="ogp">{url}</div> }))

import { ItemForm } from "../ItemForm"
import type { ShoppingItem } from "@/lib/db"

const existing: ShoppingItem = {
  id: "item-1", name: "牛乳", quantity: 2, memo: "低脂肪", tagIds: ["t1"], groupId: undefined,
  createdAt: new Date(), updatedAt: new Date(),
}

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } })

beforeEach(() => {
  vi.resetAllMocks()
  h.user = null
  h.groups = []
  h.tags = [{ id: "t1", name: "食品" }, { id: "t2", name: "日用品" }]
  h.tagsLoading = false
  h.groupsLoading = false
  h.processing = false
  h.createItem.mockResolvedValue(undefined)
  h.updateItem.mockResolvedValue(undefined)
  h.deleteItem.mockResolvedValue(undefined)
  h.createTag.mockResolvedValue({ id: "new-tag" })
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("ItemForm: 追加", () => {
  it("名前が空の間は追加できない", () => {
    render(<ItemForm onClose={vi.fn()} />)
    expect(screen.getByTestId("item-submit")).toBeDisabled()
    type("item-name-input", "   ")
    expect(screen.getByTestId("item-submit")).toBeDisabled()
  })

  it("入力した内容を前後の空白を除いて作成し、onSaved と onClose を呼ぶ", async () => {
    const onClose = vi.fn()
    const onSaved = vi.fn()
    render(<ItemForm onClose={onClose} onSaved={onSaved} />)
    type("item-name-input", "  卵 ")
    type("item-memo-input", "  ")
    fireEvent.click(screen.getByTestId("quantity-increase"))
    fireEvent.click(screen.getByText("食品"))
    fireEvent.click(screen.getByTestId("item-submit"))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(h.createItem).toHaveBeenCalledWith({ name: "卵", quantity: 2, memo: undefined, tagIds: ["t1"], groupId: undefined })
    expect(onSaved).toHaveBeenCalled()
  })

  it("タグをもう一度押すと選択が外れる", async () => {
    render(<ItemForm onClose={vi.fn()} />)
    type("item-name-input", "卵")
    fireEvent.click(screen.getByText("食品"))
    fireEvent.click(screen.getByText("食品", { selector: "button" }))
    fireEvent.click(screen.getByTestId("item-submit"))
    await waitFor(() => expect(h.createItem).toHaveBeenCalled())
    expect(h.createItem.mock.calls[0][0].tagIds).toEqual([])
  })

  it("保存に失敗したら閉じず、もう一度押せる状態に戻る", async () => {
    h.createItem.mockRejectedValue(new Error("fail"))
    const onClose = vi.fn()
    render(<ItemForm onClose={onClose} />)
    type("item-name-input", "卵")
    fireEvent.click(screen.getByTestId("item-submit"))
    await waitFor(() => expect(console.error).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId("item-submit")).not.toBeDisabled())
  })

  it("保存中は「保存中...」を出して押せない", () => {
    h.processing = true
    render(<ItemForm onClose={vi.fn()} />)
    expect(screen.getByTestId("item-submit")).toHaveTextContent("保存中...")
    expect(screen.getByTestId("item-submit")).toBeDisabled()
  })

  it("読み込み中はスピナーだけを出す", () => {
    h.tagsLoading = true
    render(<ItemForm onClose={vi.fn()} />)
    expect(screen.queryByTestId("item-form")).not.toBeInTheDocument()
  })

  it("ログイン中はグループの読み込みも待つ", () => {
    h.user = { id: "u" }
    h.groupsLoading = true
    render(<ItemForm onClose={vi.fn()} />)
    expect(screen.queryByTestId("item-form")).not.toBeInTheDocument()
  })

  it("メモに URL があると OGP プレビューを出す", () => {
    render(<ItemForm onClose={vi.fn()} />)
    expect(screen.queryByTestId("ogp")).not.toBeInTheDocument()
    type("item-memo-input", "これ https://example.com/a を買う")
    expect(screen.getByTestId("ogp")).toHaveTextContent("https://example.com/a")
  })
})

describe("ItemForm: 追加して続ける", () => {
  it("名前・数量・メモを空に戻し、閉じない（タグは維持）", async () => {
    const onClose = vi.fn()
    render(<ItemForm onClose={onClose} allowContinue />)
    type("item-name-input", "卵")
    type("item-memo-input", "L サイズ")
    fireEvent.click(screen.getByTestId("quantity-increase"))
    fireEvent.click(screen.getByText("食品"))
    fireEvent.click(screen.getByTestId("item-add-continue"))
    await waitFor(() => expect(screen.getByTestId("item-name-input")).toHaveValue(""))
    expect(screen.getByTestId("item-memo-input")).toHaveValue("")
    expect(screen.getByTestId("quantity-display")).toHaveTextContent("1")
    expect(screen.getByText("選択中:")).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("保存している間に入力された内容は消さない", async () => {
    let resolve!: () => void
    h.createItem.mockReturnValue(new Promise<void>((r) => (resolve = r)))
    render(<ItemForm onClose={vi.fn()} allowContinue />)
    type("item-name-input", "卵")
    fireEvent.click(screen.getByTestId("item-add-continue"))
    type("item-name-input", "牛乳")
    resolve()
    await waitFor(() => expect(screen.getByTestId("item-add-continue")).not.toBeDisabled())
    expect(screen.getByTestId("item-name-input")).toHaveValue("牛乳")
  })

  it("「追加して閉じる」は閉じる", async () => {
    const onClose = vi.fn()
    render(<ItemForm onClose={onClose} allowContinue />)
    type("item-name-input", "卵")
    fireEvent.click(screen.getByTestId("item-add-close"))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it("編集のときは「追加して続ける」を出さない", () => {
    render(<ItemForm item={existing} onClose={vi.fn()} allowContinue />)
    expect(screen.queryByTestId("item-add-continue")).not.toBeInTheDocument()
    expect(screen.getByTestId("item-submit")).toHaveTextContent("更新")
  })
})

describe("ItemForm: 編集と削除", () => {
  it("既存の値で初期化し、更新時は id 付きで updateItem を呼ぶ", async () => {
    const onClose = vi.fn()
    render(<ItemForm item={existing} onClose={onClose} />)
    expect(screen.getByTestId("item-name-input")).toHaveValue("牛乳")
    expect(screen.getByTestId("item-memo-input")).toHaveValue("低脂肪")
    expect(screen.getByTestId("quantity-display")).toHaveTextContent("2")
    type("item-name-input", "豆乳")
    fireEvent.click(screen.getByTestId("item-submit"))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(h.updateItem).toHaveBeenCalledWith({ id: "item-1", name: "豆乳", quantity: 2, memo: "低脂肪", tagIds: ["t1"], groupId: undefined })
    expect(h.createItem).not.toHaveBeenCalled()
  })

  it("別のアイテムに切り替わったら入力を切り替え先の値にする", () => {
    const { rerender } = render(<ItemForm item={existing} onClose={vi.fn()} />)
    rerender(<ItemForm item={{ ...existing, id: "item-2", name: "卵", memo: undefined }} onClose={vi.fn()} />)
    expect(screen.getByTestId("item-name-input")).toHaveValue("卵")
    expect(screen.getByTestId("item-memo-input")).toHaveValue("")
    rerender(<ItemForm item={null} onClose={vi.fn()} />)
    expect(screen.getByTestId("item-name-input")).toHaveValue("")
  })

  it("削除は確認を挟み、キャンセルで戻れる", () => {
    render(<ItemForm item={existing} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId("item-delete-button"))
    expect(screen.getByTestId("item-delete-confirm")).toBeInTheDocument()
    fireEvent.click(screen.getByText("キャンセル"))
    expect(screen.queryByTestId("item-delete-confirm")).not.toBeInTheDocument()
    expect(h.deleteItem).not.toHaveBeenCalled()
  })

  it("確認後に削除すると deleteItem・onDeleted・onClose を呼ぶ", async () => {
    const onClose = vi.fn()
    const onDeleted = vi.fn()
    render(<ItemForm item={existing} onClose={onClose} onDeleted={onDeleted} />)
    fireEvent.click(screen.getByTestId("item-delete-button"))
    fireEvent.click(screen.getByTestId("item-delete-confirm-yes"))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(h.deleteItem).toHaveBeenCalledWith("item-1")
    expect(onDeleted).toHaveBeenCalled()
  })

  it("削除に失敗したら閉じない", async () => {
    h.deleteItem.mockRejectedValue(new Error("fail"))
    const onClose = vi.fn()
    render(<ItemForm item={existing} onClose={onClose} />)
    fireEvent.click(screen.getByTestId("item-delete-button"))
    fireEvent.click(screen.getByTestId("item-delete-confirm-yes"))
    await waitFor(() => expect(console.error).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe("ItemForm: タグの追加", () => {
  const openTagInput = () => {
    fireEvent.click(screen.getAllByText("追加", { selector: "button" }).find((b) => b.className.includes("border-dashed"))!)
    return screen.getByPlaceholderText("新しいタグ名")
  }

  it("新しい名前なら作成して選択する", async () => {
    render(<ItemForm onClose={vi.fn()} />)
    const input = openTagInput()
    fireEvent.change(input, { target: { value: " 新タグ " } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(h.createTag).toHaveBeenCalledWith({ name: "新タグ", groupId: undefined }))
    await waitFor(() => expect(screen.queryByPlaceholderText("新しいタグ名")).not.toBeInTheDocument())
  })

  it("同じ名前の既存タグがあれば作らずにそれを選択する", async () => {
    render(<ItemForm onClose={vi.fn()} />)
    const input = openTagInput()
    fireEvent.change(input, { target: { value: "日用品" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(screen.getByText("選択中:")).toBeInTheDocument())
    expect(h.createTag).not.toHaveBeenCalled()
  })

  it("空の名前では何もしない", () => {
    render(<ItemForm onClose={vi.fn()} />)
    const input = openTagInput()
    fireEvent.keyDown(input, { key: "Enter" })
    expect(h.createTag).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText("新しいタグ名")).toBeInTheDocument()
  })

  it("Escape とキャンセルボタンで入力を閉じる", () => {
    render(<ItemForm onClose={vi.fn()} />)
    fireEvent.keyDown(openTagInput(), { key: "Escape" })
    expect(screen.queryByPlaceholderText("新しいタグ名")).not.toBeInTheDocument()
    openTagInput()
    fireEvent.click(screen.getByLabelText("キャンセル"))
    expect(screen.queryByPlaceholderText("新しいタグ名")).not.toBeInTheDocument()
  })

  it("追加ボタンでも作成できる", async () => {
    render(<ItemForm onClose={vi.fn()} />)
    const input = openTagInput()
    fireEvent.change(input, { target: { value: "新" } })
    const buttons = screen.getAllByText("追加", { selector: "button" })
    fireEvent.click(buttons.find((b) => b.className.includes("bg-blue-600"))!)
    await waitFor(() => expect(h.createTag).toHaveBeenCalled())
  })
})

describe("ItemForm: グループ", () => {
  beforeEach(() => {
    h.user = { id: "u" }
    h.groups = [{ id: "g1", name: "家族" }]
  })

  it("ログインしてグループがあれば選択でき、選んだグループで作成する", async () => {
    const onClose = vi.fn()
    render(<ItemForm onClose={onClose} />)
    fireEvent.click(screen.getByText("家族"))
    expect(h.lastTagsArg).toEqual({ groupId: "g1" })
    type("item-name-input", "卵")
    fireEvent.click(screen.getByTestId("item-submit"))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(h.createItem).toHaveBeenCalledWith(expect.objectContaining({ groupId: "g1" }))
  })

  it("「個人」に戻せる", () => {
    render(<ItemForm onClose={vi.fn()} defaultGroupId="g1" />)
    expect(h.lastTagsArg).toEqual({ groupId: "g1" })
    fireEvent.click(screen.getByText("個人"))
    expect(h.lastTagsArg).toEqual({ groupId: undefined })
  })

  it("ゲストにはグループの選択を出さない", () => {
    h.user = null
    render(<ItemForm onClose={vi.fn()} />)
    expect(screen.queryByText("共有先グループ")).not.toBeInTheDocument()
  })
})
