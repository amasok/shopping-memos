import { describe, it, expect, vi, beforeEach } from "vitest"
import { TRPCError } from "@trpc/server"

/**
 * #135: finishShopping は、業務ルールの違反だけを BAD_REQUEST にしてメッセージを返す。
 * DB のエラーなどを BAD_REQUEST に包むと、errorFormatter の INTERNAL_SERVER_ERROR のマスクを素通りしてしまう
 */
const state = vi.hoisted(() => ({ error: null as unknown }))

vi.mock("@/infrastructure/auth/server", () => ({ getAuth: vi.fn() }))
vi.mock("@/modules/shopping/application/services/ShoppingSyncService", () => ({
  ShoppingSyncService: class {
    canAccessList = async () => true
  },
}))
vi.mock("@/modules/shopping/application/services/ShoppingService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/shopping/application/services/ShoppingService")>()
  return {
    ...actual,
    ShoppingService: class {
      finishShopping = async () => {
        throw state.error
      }
    },
  }
})

import { shoppingRouter } from "@/infrastructure/trpc/routers/shopping"
import { ShoppingDomainError } from "@/modules/shopping/application/services/ShoppingService"

const LIST_ID = "11111111-1111-4111-8111-111111111111"
const finish = () => shoppingRouter.createCaller({ userId: "user-A" }).finishShopping({ listId: LIST_ID })

/** 拒否されたエラーを取り出す（TRPCError は cause を持つので、toMatchObject ではなく項目ごとに確かめる） */
const rejection = async (): Promise<TRPCError> => {
  try {
    await finish()
  } catch (error) {
    return error as TRPCError
  }
  throw new Error("拒否されなかった")
}

beforeEach(() => {
  state.error = null
})

describe("finishShopping のエラーの扱い (#135)", () => {
  it("業務ルールの違反は BAD_REQUEST にして、メッセージをそのまま返す", async () => {
    state.error = new ShoppingDomainError("このリストは既に完了しています")
    const error = await rejection()
    expect(error).toBeInstanceOf(TRPCError)
    expect(error.code).toBe("BAD_REQUEST")
    expect(error.message).toBe("このリストは既に完了しています")
  })

  it("DB のエラーなどは BAD_REQUEST に包まず、INTERNAL_SERVER_ERROR にする（本番では汎用の文言になる）", async () => {
    state.error = new Error('Failed query: update "shopping_lists" ... params: user-A')
    const error = await rejection()
    expect(error).toBeInstanceOf(TRPCError)
    expect(error.code).toBe("INTERNAL_SERVER_ERROR")
  })
})
