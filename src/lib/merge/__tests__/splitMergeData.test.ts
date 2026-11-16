import { describe, it, expect } from "vitest"
import { MERGE_ENTITY_ORDER, hasMergeData, splitMergeData, type MergeChunk } from "../splitMergeData"

type Rec = { id: string; memo?: string }

const recs = (prefix: string, n: number, memo = ""): Rec[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, ...(memo ? { memo } : {}) }))

const empty = (): MergeChunk<Rec> => ({ tags: [], items: [], lists: [], listItems: [], history: [] })

const bigLimits = { tags: 1000, items: 1000, lists: 1000, listItems: 1000, history: 1000 }
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
/** 実際に送る tRPC の入力の大きさ（superjson のバッチ形式） */
const requestBytes = (chunk: MergeChunk<Rec>) => bytes({ 0: { json: { data: chunk } } })

/** チャンクを並べたときの、エンティティごとのレコードの並び */
const flatten = (chunks: MergeChunk<Rec>[]) =>
  Object.fromEntries(MERGE_ENTITY_ORDER.map((key) => [key, chunks.flatMap((c) => c[key].map((r) => r.id))]))

describe("splitMergeData (#116)", () => {
  it("上限に収まるデータは 1 回で送る", () => {
    const data = { ...empty(), tags: recs("t", 3), items: recs("i", 5) }
    const chunks = splitMergeData(data, { limits: bigLimits, maxBytes: 1_000_000 })
    expect(chunks).toEqual([data])
  })

  it("データがなければ 1 回も送らない", () => {
    expect(splitMergeData(empty(), { limits: bigLimits, maxBytes: 1000 })).toEqual([])
    expect(hasMergeData(empty())).toBe(false)
    expect(hasMergeData({ ...empty(), history: recs("h", 1) })).toBe(true)
  })

  it("エンティティごとの件数の上限で分け、すべてのレコードを順番どおり 1 回ずつ送る", () => {
    const data = { ...empty(), tags: recs("t", 5), items: recs("i", 2500), listItems: recs("li", 1200) }
    const limits = { ...bigLimits, items: 1000, listItems: 1000 }
    const chunks = splitMergeData(data, { limits, maxBytes: 10_000_000 })

    for (const chunk of chunks) {
      for (const key of MERGE_ENTITY_ORDER) expect(chunk[key].length).toBeLessThanOrEqual(limits[key])
    }
    expect(flatten(chunks)).toEqual(flatten([data]))
  })

  it("JSON の大きさの上限で分け、どのリクエストも上限を超えない", () => {
    const data = { ...empty(), items: recs("i", 300, "あ".repeat(500)), listItems: recs("li", 300, "い".repeat(500)) }
    const maxBytes = 100_000
    const chunks = splitMergeData(data, { limits: bigLimits, maxBytes })

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(requestBytes(chunk)).toBeLessThanOrEqual(maxBytes)
    expect(flatten(chunks)).toEqual(flatten([data]))
  })

  it("参照される側を先に送る（どのレコードも、前の種類のレコードより前のリクエストにならない）", () => {
    const data = {
      tags: recs("t", 30),
      items: recs("i", 30),
      lists: recs("l", 30),
      listItems: recs("li", 30),
      history: recs("h", 30),
    }
    const limits = { tags: 7, items: 7, lists: 7, listItems: 7, history: 7 }
    const chunks = splitMergeData(data, { limits, maxBytes: 10_000_000 })

    // 種類ごとに、最初に現れるリクエストの番号と最後に現れる番号
    const range = (key: (typeof MERGE_ENTITY_ORDER)[number]) => {
      const idx = chunks.map((c, i) => (c[key].length > 0 ? i : -1)).filter((i) => i >= 0)
      return { first: Math.min(...idx), last: Math.max(...idx) }
    }
    for (let k = 1; k < MERGE_ENTITY_ORDER.length; k++) {
      expect(range(MERGE_ENTITY_ORDER[k]).first).toBeGreaterThanOrEqual(range(MERGE_ENTITY_ORDER[k - 1]).last)
    }
  })

  it("1 件だけで上限を超えるレコードも、単独のリクエストにして落とさない", () => {
    const data = { ...empty(), items: [{ id: "small" }, { id: "huge", memo: "x".repeat(5000) }, { id: "small2" }] }
    const chunks = splitMergeData(data, { limits: bigLimits, maxBytes: 1000 })
    expect(flatten(chunks).items).toEqual(["small", "huge", "small2"])
    expect(chunks.find((c) => c.items.some((r) => r.id === "huge"))?.items).toHaveLength(1)
  })
})
