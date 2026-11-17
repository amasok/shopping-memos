import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"

/**
 * 買い物リストの画面の完了（179b。openspec の shopping「チェック 0 件の完了」）
 *
 * hooks をモックし、ダイアログの選択と完了の失敗の表示を確かめる。
 * 端末の DB・サーバーでの結果は E2E（e2e/shopping.spec.ts・e2e/auth/）で確かめる
 */
const state = vi.hoisted(() => ({
  items: [] as Array<{ id: string; name: string; checked: boolean; quantity: number }>,
  push: vi.fn(),
  replace: vi.fn(),
  refetch: vi.fn(),
  deleteList: vi.fn(),
  finishShopping: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, replace: state.replace }),
  useSearchParams: () => new URLSearchParams("id=list-1"),
}))
vi.mock("@/components/layouts/AppLayout", () => ({ AppLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock("@/components/layouts/Header", () => ({ Header: () => null }))
vi.mock("@/components/features/items/ItemSelector", () => ({ ItemSelector: () => null }))
vi.mock("@/hooks/data", () => ({
  useList: () => ({
    list: { id: "list-1", name: "買い物", status: "in_progress", groupId: null },
    items: state.items,
    isLoading: false,
    refetch: state.refetch,
  }),
  useItems: () => ({ items: [], isLoading: false }),
  useTags: () => ({ tags: [], isLoading: false }),
  useListMutations: () => ({
    checkItem: vi.fn(),
    removeItemFromList: vi.fn(),
    addItemToList: vi.fn(),
    addNewItemToList: vi.fn(),
    updateList: vi.fn(),
    deleteList: state.deleteList,
    finishShopping: state.finishShopping,
  }),
}))

import ShoppingListPage from "../page"

const entry = (id: string, name: string, checked: boolean) => ({ id, name, checked, quantity: 1 })

/** BottomSheet は開くと 1 フレーム後に表示される */
async function openNoCheckedDialog() {
  fireEvent.click(await screen.findByTestId("partial-complete-button"))
  return screen.findByTestId("no-checked-dialog")
}

beforeEach(() => {
  state.items = [entry("li-milk", "牛乳", false), entry("li-egg", "卵", false)]
  state.push.mockReset()
  state.refetch.mockReset()
  state.deleteList.mockReset().mockResolvedValue({ success: true })
  state.finishShopping.mockReset().mockResolvedValue({ historyId: "list-1" })
})

afterEach(() => {
  cleanup()
})

describe("チェック 0 件の完了（179b）", () => {
  it("チェック 0 件で完了を押すと確認ダイアログを出す", async () => {
    render(<ShoppingListPage />)

    const button = await screen.findByTestId("partial-complete-button")
    expect(button).toHaveTextContent("買い物を完了")
    expect(button).not.toBeDisabled()

    const dialog = await openNoCheckedDialog()
    expect(screen.getByTestId("bottom-sheet-title")).toHaveTextContent("カゴに入れたものがありません")
    expect(dialog).toHaveTextContent("履歴は作らずに、このリストを削除します。リストの商品はどうしますか？")
    expect(screen.getByTestId("no-checked-delete-with-items")).toHaveTextContent("リストの商品ごと消す")
    expect(screen.getByTestId("no-checked-delete-list-only")).toHaveTextContent("リストだけ消して商品は元に戻す")
    expect(screen.getByTestId("no-checked-cancel")).toHaveTextContent("キャンセル")
    expect(state.finishShopping).not.toHaveBeenCalled()
  })

  it("リストの商品ごと消すと、商品も消す指定でリストを削除し、一覧に移る", async () => {
    render(<ShoppingListPage />)
    await openNoCheckedDialog()

    fireEvent.click(screen.getByTestId("no-checked-delete-with-items"))

    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/lists"))
    expect(state.deleteList).toHaveBeenCalledWith("list-1", { deleteCatalogItems: true })
    expect(state.finishShopping).not.toHaveBeenCalled()
  })

  it("リストだけ消すと、商品を消さない指定でリストを削除し、一覧に移る", async () => {
    render(<ShoppingListPage />)
    await openNoCheckedDialog()

    fireEvent.click(screen.getByTestId("no-checked-delete-list-only"))

    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/lists"))
    expect(state.deleteList).toHaveBeenCalledWith("list-1", { deleteCatalogItems: false })
    expect(state.finishShopping).not.toHaveBeenCalled()
  })

  it("キャンセルするとリストはそのまま", async () => {
    render(<ShoppingListPage />)
    await openNoCheckedDialog()

    fireEvent.click(screen.getByTestId("no-checked-cancel"))

    await waitFor(() => expect(screen.queryByTestId("no-checked-dialog")).toBeNull())
    expect(state.deleteList).not.toHaveBeenCalled()
    expect(state.finishShopping).not.toHaveBeenCalled()
    expect(state.push).not.toHaveBeenCalled()
  })

  it("削除に失敗したらダイアログにエラーを出し、リストの画面のまま", async () => {
    state.deleteList.mockRejectedValue(new Error("network"))
    render(<ShoppingListPage />)
    await openNoCheckedDialog()

    fireEvent.click(screen.getByTestId("no-checked-delete-list-only"))

    expect(await screen.findByTestId("no-checked-error")).toHaveTextContent("リストを削除できませんでした")
    expect(state.push).not.toHaveBeenCalled()
    expect(screen.getByTestId("no-checked-delete-list-only")).not.toBeDisabled()
  })
})

describe("チェック済みの商品がある完了", () => {
  it("チェック済みが 1 件以上なら、ダイアログを出さずに完了して履歴に移る", async () => {
    state.items = [entry("li-milk", "牛乳", true), entry("li-egg", "卵", false)]
    render(<ShoppingListPage />)

    fireEvent.click(await screen.findByTestId("partial-complete-button"))

    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/history"))
    expect(state.finishShopping).toHaveBeenCalledWith("list-1", "買い物")
    expect(screen.queryByTestId("no-checked-dialog")).toBeNull()
  })

  it("完了に失敗したら画面にエラーを出す", async () => {
    state.items = [entry("li-milk", "牛乳", true), entry("li-egg", "卵", false)]
    state.finishShopping.mockRejectedValue(new Error("カゴに入れた商品がありません"))
    render(<ShoppingListPage />)

    fireEvent.click(await screen.findByTestId("partial-complete-button"))

    const alert = await screen.findByTestId("complete-error")
    expect(alert).toHaveAttribute("role", "alert")
    expect(alert).toHaveTextContent("買い物を完了できませんでした")
    expect(alert).toHaveTextContent("カゴに入れた商品がありません")
    // リストを読み直し、リストの画面のまま操作を続けられる
    expect(state.refetch).toHaveBeenCalled()
    expect(state.push).not.toHaveBeenCalled()
    expect(screen.getByTestId("partial-complete-button")).not.toBeDisabled()
  })

  it("全部チェック済みの完了ボタンでも、失敗したらエラーを出す", async () => {
    state.items = [entry("li-milk", "牛乳", true)]
    state.finishShopping.mockRejectedValue(new Error("このリストは既に完了しています"))
    render(<ShoppingListPage />)

    fireEvent.click(await screen.findByTestId("complete-button"))

    expect(await screen.findByTestId("complete-error")).toHaveTextContent("このリストは既に完了しています")
    expect(state.push).not.toHaveBeenCalled()
  })
})
