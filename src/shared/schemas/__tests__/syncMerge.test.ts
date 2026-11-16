import { describe, it, expect } from "vitest"
import {
  MERGE_LIMITS,
  parseMergeData,
  syncMergeInputSchema,
  syncMergeStrictInputSchema,
} from "../sync"
import { TEXT_LIMITS, clampQuantity, clipText } from "../limits"

const id = () => crypto.randomUUID()
const iso = "2026-01-01T00:00:00.000Z"
const empty = { items: [], tags: [], lists: [], listItems: [], history: [] }

const validItem = () => ({
  id: id(),
  name: "牛乳",
  quantity: 2,
  memo: null,
  tagIds: [id()],
  purchasedAt: null,
  createdAt: iso,
})
const validList = () => ({
  id: id(),
  name: "今日の買い物",
  status: "in_progress" as const,
  createdAt: iso,
  completedAt: null,
  purchasedAt: null,
  location: null,
})

const parse = (data: unknown) => syncMergeStrictInputSchema.safeParse({ data })

describe("syncMergeInputSchema（sync.merge の入力検証 #86）", () => {
  it("ゲスト側（DataMergeContext）が送る形（ISO 文字列・null）をそのまま受け付け、日付を Date に変換する", () => {
    const listId = id()
    const result = parse({
      items: [validItem()],
      tags: [{ id: id(), name: "食品", createdAt: iso }],
      lists: [
        { ...validList(), id: listId, purchasedAt: iso, location: "スーパー" },
      ],
      listItems: [
        {
          id: id(),
          listId,
          name: "パン",
          quantity: 1,
          memo: "薄切り",
          tagIds: [],
          checked: true,
          createdAt: iso,
        },
      ],
      history: [{ id: listId, listId, location: null, purchasedAt: iso }],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data.items[0].createdAt).toBeInstanceOf(Date)
      expect(result.data.data.items[0].purchasedAt).toBeNull()
      expect(result.data.data.lists[0].purchasedAt).toBeInstanceOf(Date)
    }
  })

  it("Date オブジェクト（superjson で届く場合）も受け付ける", () => {
    expect(
      parse({ ...empty, items: [{ ...validItem(), createdAt: new Date(iso) }] })
        .success,
    ).toBe(true)
  })

  it("未知のキー（updatedAt や groupId など）は取り除いて受け付ける", () => {
    const result = parse({
      ...empty,
      items: [{ ...validItem(), updatedAt: iso, groupId: id(), extra: 1 }],
    })
    expect(result.success).toBe(true)
    if (result.success)
      expect(result.data.data.items[0]).not.toHaveProperty("extra")
  })

  it("空のデータ・省略可能な項目の欠落も受け付ける", () => {
    expect(parse(empty).success).toBe(true)
    const { memo: _m, purchasedAt: _p, ...rest } = validItem()
    expect(parse({ ...empty, items: [rest] }).success).toBe(true)
  })

  describe("不正な入力は拒否する", () => {
    it.each([
      ["id が空文字", { ...validItem(), id: "" }],
      ["id が UUID でない", { ...validItem(), id: "not-a-uuid" }],
      [
        "id が欠落",
        (() => {
          const { id: _i, ...r } = validItem()
          return r
        })(),
      ],
      ["name が空", { ...validItem(), name: "" }],
      ["name が 101 文字", { ...validItem(), name: "あ".repeat(101) }],
      [
        "memo が 2001 文字",
        { ...validItem(), memo: "あ".repeat(TEXT_LIMITS.memo + 1) },
      ],
      ["quantity が 0", { ...validItem(), quantity: 0 }],
      ["quantity が小数", { ...validItem(), quantity: 1.5 }],
      [
        "quantity が上限超え",
        { ...validItem(), quantity: TEXT_LIMITS.quantityMax + 1 },
      ],
      ["tagIds に UUID でない値", { ...validItem(), tagIds: ["x"] }],
      [
        "tagIds が上限超え",
        {
          ...validItem(),
          tagIds: Array.from({ length: MERGE_LIMITS.tagIdsPerEntity + 1 }, id),
        },
      ],
      ["createdAt が不正な日付", { ...validItem(), createdAt: "not-a-date" }],
      [
        "createdAt が欠落",
        (() => {
          const { createdAt: _c, ...r } = validItem()
          return r
        })(),
      ],
    ])("items: %s", (_label, item) => {
      expect(parse({ ...empty, items: [item] }).success).toBe(false)
    })

    it("tags: name が 51 文字", () => {
      expect(
        parse({
          ...empty,
          tags: [{ id: id(), name: "あ".repeat(51), createdAt: iso }],
        }).success,
      ).toBe(false)
    })

    it.each([
      ["status が不正", { ...validList(), status: "done" }],
      ["location が 101 文字", { ...validList(), location: "あ".repeat(101) }],
      ["completedAt が不正な日付", { ...validList(), completedAt: "xxx" }],
    ])("lists: %s", (_label, list) => {
      expect(parse({ ...empty, lists: [list] }).success).toBe(false)
    })

    it("listItems: listId が UUID でない", () => {
      const li = {
        id: id(),
        listId: "x",
        name: "a",
        quantity: 1,
        tagIds: [],
        checked: false,
        createdAt: iso,
      }
      expect(parse({ ...empty, listItems: [li] }).success).toBe(false)
    })

    it("history: purchasedAt が欠落", () => {
      expect(
        parse({ ...empty, history: [{ id: id(), listId: id() }] }).success,
      ).toBe(false)
    })

    it("配列の件数が上限を超える", () => {
      const tooMany = Array.from({ length: MERGE_LIMITS.items + 1 }, validItem)
      expect(parse({ ...empty, items: tooMany }).success).toBe(false)
    })

    it("data の配列が欠落、または配列でない", () => {
      expect(
        parse({ items: [], tags: [], lists: [], listItems: [] }).success,
      ).toBe(false)
      expect(parse({ ...empty, items: "x" }).success).toBe(false)
    })
  })
})

describe("送信前の整形（clipText / clampQuantity）", () => {
  it("clipText は上限を超える分だけを切り詰める", () => {
    expect(clipText("abc", 5)).toBe("abc")
    expect(clipText("abcdef", 5)).toBe("abcde")
  })
  it("clipText は絵文字（サロゲートペア）の途中で切らない", () => {
    // 😀 は UTF-16 で 2 単位。5 単位で切ると 3 つ目の絵文字の前半で切れるので、1 文字手前（4 単位）で切る
    const clipped = clipText("😀".repeat(3), 5)
    expect(clipped).toBe("😀😀")
    expect(clipped.length).toBeLessThanOrEqual(5)
    // ちょうど境界なら、そのまま
    expect(clipText("😀😀", 4)).toBe("😀😀")
  })
  it("clampQuantity は 1〜上限の整数に収める", () => {
    expect(clampQuantity(0)).toBe(1)
    expect(clampQuantity(-3)).toBe(1)
    expect(clampQuantity(2.9)).toBe(2)
    expect(clampQuantity(100000)).toBe(TEXT_LIMITS.quantityMax)
    expect(clampQuantity(Number.NaN)).toBe(1)
  })
})

describe("parseMergeData（1 件ずつの検証 #86）", () => {
  const input = (data: Partial<Record<keyof typeof empty, unknown[]>>) =>
    syncMergeInputSchema.parse({ data: { ...empty, ...data } }).data

  it("形式が不正な 1 件は errors に入れてスキップし、ほかのデータは取り込む", () => {
    const good = validItem()
    const { data, errors } = parseMergeData(
      input({
        items: [{ ...validItem(), id: "not-a-uuid" }, good],
        tags: [
          { id: id(), name: "食品", createdAt: iso },
          { id: "x", name: "y", createdAt: iso },
        ],
      }),
    )
    expect(data.items.map((i) => i.id)).toEqual([good.id])
    expect(data.tags).toHaveLength(1)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain("アイテム 1 件目")
    expect(errors[1]).toContain("タグ 2 件目")
  })

  it("エラー文にデータの中身（名前など）を含めない", () => {
    const { errors } = parseMergeData(
      input({ items: [{ ...validItem(), id: "bad", name: "秘密の名前" }] }),
    )
    expect(errors.join()).not.toContain("秘密の名前")
  })

  it("すべて正しければ errors は空", () => {
    expect(parseMergeData(input({ items: [validItem()] })).errors).toEqual([])
  })

  it("配列の件数が上限を超える入力は、tRPC の入力検証で拒否する", () => {
    const tooMany = Array.from({ length: MERGE_LIMITS.items + 1 }, validItem)
    expect(
      syncMergeInputSchema.safeParse({ data: { ...empty, items: tooMany } })
        .success,
    ).toBe(false)
  })
})
