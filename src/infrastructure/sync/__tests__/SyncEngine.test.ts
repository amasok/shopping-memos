// @vitest-environment node
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ShoppingMemosDB, type SyncQueueItem } from "@/lib/db"
import { getMeta, setMeta } from "@/lib/db/meta"
import type { SyncPullInput, SyncPullOutput, SyncPushInput, SyncPushOutput } from "@/shared/schemas/sync"
import { applyServerChanges } from "../applyServerRows"
import { BACKOFF_MAX_MS, PUSH_DEBOUNCE_MS, SyncEngine, classifySyncError, pushOutcome, type SyncEngineOptions } from "../SyncEngine"

const SERVER_TIME = "2026-11-17T10:00:00.000Z"
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

let database: ShoppingMemosDB
let timers: Array<{ callback: () => void; ms: number }>

function op(n: number, overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    id: uuid(n),
    seq: n,
    entity: "tag",
    entityId: uuid(1000 + n),
    type: "update",
    patch: { name: `t${n}` },
    clientTime: SERVER_TIME,
    retryCount: 0,
    status: "pending",
    ...overrides,
  }
}

function pullPage(overrides: Partial<SyncPullOutput> = {}): SyncPullOutput {
  return {
    serverTime: SERVER_TIME,
    changes: { tags: [], items: [], lists: [], listItems: [] },
    memberships: { groupIds: [] },
    nextCursor: "c1",
    hasMore: false,
    ...overrides,
  }
}

const applyAll = async (input: SyncPushInput): Promise<SyncPushOutput> => ({
  serverTime: SERVER_TIME,
  results: input.operations.map((o) => ({ opId: o.opId, status: "applied" as const })),
})

function trpcError(code: string, httpStatus: number, message = code) {
  return Object.assign(new Error(message), { data: { code, httpStatus } })
}

function engine(overrides: Partial<SyncEngineOptions> = {}) {
  const transport = {
    push: vi.fn(applyAll),
    pull: vi.fn<(input: SyncPullInput) => Promise<SyncPullOutput>>(async () => pullPage()),
  }
  const instance = new SyncEngine({
    db: database,
    transport,
    mode: "full",
    lockName: "sync-test",
    locks: null,
    setTimer: (callback, ms) => timers.push({ callback, ms }),
    clearTimer: () => {},
    ...overrides,
  })
  return { instance, transport: (overrides.transport as typeof transport | undefined) ?? transport }
}

const queue = () => database.syncQueue.orderBy("seq").toArray()

beforeEach(() => {
  database = new ShoppingMemosDB(`engine-test-${crypto.randomUUID()}`)
  timers = []
})

afterEach(async () => {
  vi.restoreAllMocks()
  await database.delete()
})

describe("SyncEngine.push", () => {
  it("積んだ順に送り、applied と duplicate（applied）をキューから消す", async () => {
    await database.syncQueue.bulkAdd([op(2), op(1)])
    const push = vi.fn(async (input: SyncPushInput) => ({
      serverTime: SERVER_TIME,
      results: [
        { opId: input.operations[0].opId, status: "applied" as const },
        { opId: input.operations[1].opId, status: "duplicate" as const, reason: "applied" },
      ],
    }))
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) } })
    await instance.sync()
    expect(push.mock.calls[0][0]).toMatchObject({ protocolVersion: 1, operations: [{ opId: uuid(1) }, { opId: uuid(2) }] })
    expect(push.mock.calls[0][0].operations[0]).toEqual({
      opId: uuid(1), entity: "tag", entityId: uuid(1001), type: "update", clientTime: SERVER_TIME, patch: { name: "t1" },
    })
    expect(await queue()).toEqual([])
    expect(instance.getState()).toMatchObject({ pendingCount: 0, failedCount: 0, isSyncing: false })
  })

  it("100 件ごとに分けて送る", async () => {
    await database.syncQueue.bulkAdd(Array.from({ length: 150 }, (_, i) => op(i + 1)))
    const { instance, transport } = engine()
    await instance.sync()
    expect(transport.push.mock.calls.map((c) => c[0].operations.length)).toEqual([100, 50])
  })

  it("conflict は serverRow をローカルに反映し（tombstone なら消す）、通知する", async () => {
    await database.tags.add({ id: uuid(1001), name: "古い", createdAt: new Date(0), updatedAt: new Date(0) })
    await database.syncQueue.add(op(1))
    const onConflict = vi.fn()
    const push = vi.fn(async () => ({
      serverTime: SERVER_TIME,
      results: [{ opId: uuid(1), status: "conflict" as const, reason: "deleted", serverRow: { id: uuid(1001), deletedAt: new Date() } }],
    }))
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) }, onConflict })
    await instance.sync()
    expect(await database.tags.get(uuid(1001))).toBeUndefined()
    expect(onConflict).toHaveBeenCalledWith(expect.objectContaining({ status: "conflict" }))
    expect(await queue()).toEqual([])
  })

  it("partial は最新の行で上書きする。ただし同じエンティティに未送信の操作が残っていれば上書きしない", async () => {
    await database.syncQueue.bulkAdd([op(1), op(2, { entityId: uuid(2001) })])
    await database.syncQueue.add(op(3, { entityId: uuid(2001), status: "failed" }))
    const row = (id: string, name: string) => ({ id, name, groupId: null, createdAt: new Date(0), updatedAt: new Date(1), deletedAt: null })
    let beforeSecondPush: unknown = "not called"
    const push = vi.fn(async (input: SyncPushInput) => {
      if (input.operations.length === 2) {
        // 2 件目を送っている間に、同じエンティティへの新しい操作が積まれた
        await database.syncQueue.add(op(4, { entityId: uuid(2001) }))
      } else {
        beforeSecondPush = await database.tags.get(uuid(2001))
      }
      return {
        serverTime: SERVER_TIME,
        results: input.operations.map((o) => ({
          opId: o.opId, status: "partial" as const, serverRow: row(o.entityId, "サーバー"),
        })),
      }
    })
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) }, mode: "drain" })
    await instance.sync()
    expect(await database.tags.get(uuid(1001))).toMatchObject({ name: "サーバー" })
    expect((await database.tags.get(uuid(1001)))?.groupId).toBeUndefined()
    // 1 回目の partial では、未送信の op(4) があるので上書きしない
    expect(beforeSecondPush).toBeUndefined()
    // op(4) を送った後の partial では上書きする（未送信の操作がなくなった）
    expect(push).toHaveBeenCalledTimes(2)
    expect(await database.tags.get(uuid(2001))).toMatchObject({ name: "サーバー" })
  })

  it("rejected と duplicate（rejected）は failed にし、件数に出す", async () => {
    await database.syncQueue.bulkAdd([op(1), op(2)])
    const push = vi.fn(async () => ({
      serverTime: SERVER_TIME,
      results: [
        { opId: uuid(1), status: "rejected" as const, reason: "not_found" },
        { opId: uuid(2), status: "duplicate" as const, reason: "rejected:invalid_patch" },
      ],
    }))
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) } })
    await instance.sync()
    expect((await queue()).map((q) => [q.status, q.lastError])).toEqual([
      ["failed", "not_found"],
      ["failed", "rejected:invalid_patch"],
    ])
    expect(instance.getState().failedCount).toBe(2)
  })

  it("duplicate（partial / conflict）はキューから消し、次の pull をカーソルなしで取り直す", async () => {
    await setMeta(database, "cursor", "old")
    await database.syncQueue.add(op(1))
    const push = vi.fn(async () => ({
      serverTime: SERVER_TIME,
      results: [{ opId: uuid(1), status: "duplicate" as const, reason: "partial" }],
    }))
    const pull = vi.fn<(input: SyncPullInput) => Promise<SyncPullOutput>>(async () => pullPage())
    const { instance } = engine({ transport: { push, pull } })
    await instance.sync()
    expect(await queue()).toEqual([])
    expect(pull.mock.calls[0][0].cursor).toBeUndefined()
  })

  it("結果が返らなかった操作は pending に戻し、1 件も返らなければバックオフする（送り続けない）", async () => {
    await database.syncQueue.bulkAdd([op(1), op(2)])
    const push = vi.fn(async () => ({ serverTime: SERVER_TIME, results: [{ opId: uuid(1), status: "applied" as const }] }))
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) } })
    await instance.sync()
    expect(push).toHaveBeenCalledTimes(2)
    expect((await queue()).map((q) => [q.id, q.status])).toEqual([[uuid(2), "pending"]])
    expect(timers.map((t) => t.ms)).toEqual([2000])
    expect(instance.getState().isOnline).toBe(true)
  })

  it("送信中に積まれた変更は、送信中の操作にまとめず別に送る", async () => {
    await database.syncQueue.add(op(1, { patch: { name: "A" } }))
    const { enqueue } = await import("@/infrastructure/local/syncQueue")
    const sent: unknown[] = []
    const push = vi.fn(async (input: SyncPushInput) => {
      sent.push(input.operations.map((o) => o.patch))
      if (sent.length === 1) {
        await enqueue(database, { entity: "tag", entityId: uuid(1001), type: "update", patch: { name: "B" }, clientTime: SERVER_TIME })
      }
      return applyAll(input)
    })
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) } })
    await instance.sync()
    expect(sent).toEqual([[{ name: "A" }], [{ name: "B" }]])
    expect(await queue()).toEqual([])
  })

  it("ネットワークエラーの後に積んだ update は、送った操作にまとめず別の操作として送る", async () => {
    const { enqueue } = await import("@/infrastructure/local/syncQueue")
    await enqueue(database, { entity: "tag", entityId: uuid(1001), type: "update", patch: { name: "A" }, clientTime: SERVER_TIME })
    const push = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockImplementation(applyAll)
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) }, mode: "drain" })
    await instance.sync()
    await enqueue(database, { entity: "tag", entityId: uuid(1001), type: "update", patch: { name: "B" }, clientTime: SERVER_TIME })
    expect((await queue()).map((q) => q.patch)).toEqual([{ name: "A" }, { name: "B" }])
    await instance.sync()
    expect(push.mock.calls.slice(1).map((c) => c[0].operations.map((o: { patch: unknown }) => o.patch))).toEqual([
      [{ name: "A" }, { name: "B" }],
    ])
  })

  it("結果が返らなかった create の後の delete は、create を消さずに積む", async () => {
    const { enqueue } = await import("@/infrastructure/local/syncQueue")
    await enqueue(database, { entity: "tag", entityId: uuid(1001), type: "create", patch: { name: "A" }, clientTime: SERVER_TIME })
    const push = vi.fn(async () => ({ serverTime: SERVER_TIME, results: [] }))
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) }, mode: "drain" })
    await instance.sync()
    await enqueue(database, { entity: "tag", entityId: uuid(1001), type: "delete", clientTime: SERVER_TIME })
    expect((await queue()).map((q) => q.type)).toEqual(["create", "delete"])
  })

  it("入力ごと拒否されたら半分ずつに分けて送り直し、拒否された 1 件だけを failed にする", async () => {
    await database.syncQueue.bulkAdd([op(1), op(2), op(3), op(4), op(5)])
    vi.spyOn(console, "error").mockImplementation(() => {})
    const push = vi.fn(async (input: SyncPushInput) => {
      if (input.operations.some((o) => o.opId === uuid(3))) throw trpcError("BAD_REQUEST", 400, "invalid")
      return applyAll(input)
    })
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) }, mode: "drain" })
    await instance.sync()
    expect((await queue()).map((q) => [q.id, q.status, q.lastError])).toEqual([[uuid(3), "failed", "invalid"]])
    expect(push.mock.calls.map((c) => c[0].operations.length)).toEqual([5, 3, 2, 2, 1, 2])
  })

  it("tRPC の形でない 4xx（413 など）も、入力ごとの拒否として扱う", () => {
    const tooLarge = Object.assign(new Error("Payload Too Large"), { meta: { response: { status: 413 } } })
    expect(classifySyncError(tooLarge)).toBe("invalid")
    expect(classifySyncError(Object.assign(new Error("x"), { meta: { response: { status: 502 } } }))).toBe("retry")
  })

  it("再送（duplicate）と拒否（rejected）の後は、カーソルを捨てて次の pull を最初から取る（pull が失敗しても残る）", async () => {
    for (const result of [
      { status: "duplicate" as const, reason: "applied" },
      { status: "rejected" as const, reason: "not_found" },
    ]) {
      await setMeta(database, "cursor", "old")
      await database.syncQueue.add(op(1))
      const push = vi.fn(async () => ({ serverTime: SERVER_TIME, results: [{ opId: uuid(1), ...result }] }))
      const pull = vi.fn<(input: SyncPullInput) => Promise<SyncPullOutput>>().mockRejectedValueOnce(new TypeError("offline"))
      pull.mockResolvedValue(pullPage())
      const { instance } = engine({ transport: { push, pull } })
      await instance.sync()
      expect(await getMeta(database, "cursor")).toBeUndefined()
      await instance.sync()
      expect(pull.mock.calls.map((c) => c[0].cursor)).toEqual([undefined, undefined])
      await database.syncQueue.clear()
    }
  })

  it("前の実行で送信中のまま残った操作も送る", async () => {
    await database.syncQueue.add(op(1, { status: "inflight" }))
    const { instance, transport } = engine()
    await instance.sync()
    expect(transport.push).toHaveBeenCalledTimes(1)
    expect(await queue()).toEqual([])
  })

  it("ネットワークエラーは pending に戻し、2 秒から倍にしながら再試行する。成功したら戻す", async () => {
    await database.syncQueue.add(op(1))
    const push = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) } })
    await instance.sync()
    expect((await queue())[0]).toMatchObject({ status: "pending", retryCount: 1, attempted: true })
    expect(instance.getState().isOnline).toBe(false)
    timers[0].callback()
    await vi.waitFor(() => expect(timers).toHaveLength(2))
    expect(timers.map((t) => t.ms)).toEqual([2000, 4000])

    push.mockImplementation(applyAll)
    timers[1].callback()
    await vi.waitFor(() => expect(instance.getState().isOnline).toBe(true))
    await instance.sync()
    push.mockRejectedValue(trpcError("INTERNAL_SERVER_ERROR", 500))
    await database.syncQueue.add(op(2))
    await instance.sync()
    expect(timers.at(-1)?.ms).toBe(2000)
  })

  it("再試行の間隔は 5 分で頭打ちにする", async () => {
    await database.syncQueue.add(op(1))
    const push = vi.fn().mockRejectedValue(trpcError("INTERNAL_SERVER_ERROR", 503))
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) } })
    for (let i = 0; i < 10; i++) await instance.sync()
    expect(timers.at(-1)?.ms).toBe(BACKOFF_MAX_MS)
  })

  it("401 はセッション切れにして止まる（再試行しない）", async () => {
    await database.syncQueue.add(op(1))
    const push = vi.fn().mockRejectedValue(trpcError("UNAUTHORIZED", 401))
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) } })
    await instance.sync()
    await instance.sync()
    expect(instance.getState().sessionExpired).toBe(true)
    expect(push).toHaveBeenCalledTimes(1)
    expect(timers).toEqual([])
    expect((await queue())[0].status).toBe("pending")
  })

  it("CLIENT_TOO_OLD は clientTooOld にして止まる（キューは消さない）", async () => {
    await database.syncQueue.add(op(1))
    const push = vi.fn().mockRejectedValue(trpcError("PRECONDITION_FAILED", 412, "CLIENT_TOO_OLD"))
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) } })
    await instance.sync()
    expect(instance.getState().clientTooOld).toBe(true)
    expect(await queue()).toHaveLength(1)
  })

  it("入力ごと拒否された（BAD_REQUEST）操作は failed にして、キューを止めない", async () => {
    await database.syncQueue.add(op(1))
    const push = vi.fn().mockRejectedValue(trpcError("BAD_REQUEST", 400, "invalid"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) } })
    await instance.sync()
    expect((await queue())[0]).toMatchObject({ status: "failed", lastError: "invalid" })
    expect(timers).toEqual([])
  })

  it("403・404 など全体が拒否される 4xx では failed にせず、pending のままバックオフで再試行する", async () => {
    await setMeta(database, "cursor", "keep")
    await database.syncQueue.bulkAdd([op(1), op(2)])
    for (const [code, status] of [["FORBIDDEN", 403], ["METHOD_NOT_SUPPORTED", 405]] as const) {
      const push = vi.fn().mockRejectedValue(trpcError(code, status))
      const { instance } = engine({ transport: { push, pull: vi.fn(async () => pullPage()) } })
      await instance.sync()
      expect(push).toHaveBeenCalledTimes(1)
      expect((await queue()).map((q) => q.status)).toEqual(["pending", "pending"])
      expect(instance.getState().isOnline).toBe(true)
    }
    // WAF のチャレンジ（tRPC の形でない 403）も同じ
    const html403 = Object.assign(new Error("Forbidden"), { meta: { response: { status: 403 } } })
    const { instance } = engine({ transport: { push: vi.fn().mockRejectedValue(html403), pull: vi.fn(async () => pullPage()) } })
    await instance.sync()
    expect((await queue()).map((q) => q.status)).toEqual(["pending", "pending"])
    expect(timers.map((t) => t.ms)).toEqual([2000, 2000, 2000])
    expect(await getMeta(database, "cursor")).toBe("keep")
  })

  it("serverTime で時計のずれを補正し、保存する", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(SERVER_TIME) - 4000)
    const { instance } = engine()
    await instance.sync()
    expect(instance.getClock().getOffset()).toBe(4000)
    await vi.waitFor(async () => expect(await getMeta(database, "serverTimeOffset")).toBe(4000))
  })
})

describe("SyncEngine.pull", () => {
  const tagRow = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id, name, userId: "u1", groupId: null, createdAt: new Date(0), updatedAt: new Date(1), deletedAt: null, ...extra,
  })

  it("hasMore が false になるまで続きを取り、カーソルと最終同期を保存する。次の同期は保存したカーソルから", async () => {
    const pull = vi
      .fn()
      .mockResolvedValueOnce(pullPage({ changes: { tags: [tagRow(uuid(1), "a")], items: [], lists: [], listItems: [] }, nextCursor: "p1", hasMore: true }))
      .mockResolvedValueOnce(pullPage({ changes: { tags: [tagRow(uuid(2), "b")], items: [], lists: [], listItems: [] }, nextCursor: "p2" }))
      .mockResolvedValue(pullPage({ nextCursor: "p3" }))
    const { instance } = engine({ transport: { push: vi.fn(applyAll), pull } })
    await instance.sync()
    expect(pull.mock.calls.map((c) => c[0].cursor)).toEqual([undefined, "p1"])
    expect(await database.tags.count()).toBe(2)
    expect(await getMeta(database, "cursor")).toBe("p2")
    expect(instance.getState().lastSyncAt).toBeInstanceOf(Date)
    expect(await getMeta(database, "lastSyncAt")).toBeDefined()

    await instance.sync()
    expect(pull.mock.calls[2][0]).toEqual({ cursor: "p2", protocolVersion: 1 })
  })

  it("行をローカルの形にして入れ、tombstone は消す。削除済みのリストは下のアイテムもまとめて消す", async () => {
    await database.lists.add({ id: uuid(10), name: "消える", status: "in_progress", createdAt: new Date(0) })
    await database.listItems.add({ id: uuid(11), listId: uuid(10), name: "x", quantity: 1, tagIds: [], checked: false, createdAt: new Date(0) })
    await database.tags.add({ id: uuid(12), name: "消える", createdAt: new Date(0), updatedAt: new Date(0) })
    const page = pullPage({
      changes: {
        tags: [tagRow(uuid(12), "消える", { deletedAt: new Date() })],
        items: [{ id: uuid(20), name: "牛乳", quantity: 2, memo: null, tagIds: [uuid(1)], groupId: "g1", purchasedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: new Date(5), deletedAt: null, fieldModifiedAt: {}, userId: "u1" }],
        lists: [{ id: uuid(10), name: "消える", status: "in_progress", deletedAt: new Date() }],
        listItems: [{ id: uuid(30), listId: uuid(31), name: "卵", quantity: 1, memo: "L", tagIds: null, checked: true, createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null }],
      },
    })
    const { instance } = engine({ transport: { push: vi.fn(applyAll), pull: vi.fn(async () => page) } })
    await instance.sync()
    expect(await database.items.get(uuid(20))).toEqual({
      id: uuid(20), name: "牛乳", quantity: 2, tagIds: [uuid(1)], groupId: "g1", createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date(5),
    })
    expect(await database.listItems.get(uuid(30))).toMatchObject({ tagIds: [], memo: "L", checked: true })
    expect(await database.lists.get(uuid(10))).toBeUndefined()
    expect(await database.listItems.get(uuid(11))).toBeUndefined()
    expect(await database.tags.get(uuid(12))).toBeUndefined()
  })

  it("未送信（pending / inflight）の操作があるエンティティは上書きしない（failed は上書きする）", async () => {
    for (const n of [1, 2, 3]) {
      await database.tags.add({ id: uuid(n), name: "ローカル", createdAt: new Date(0), updatedAt: new Date(0) })
    }
    await database.syncQueue.bulkAdd([
      op(1, { entityId: uuid(1) }),
      op(2, { entityId: uuid(2), status: "inflight" }),
      op(3, { entityId: uuid(3), status: "failed" }),
    ])
    await applyServerChanges(database, { tags: [1, 2, 3].map((n) => tagRow(uuid(n), "サーバー")) })
    expect((await database.tags.orderBy("id").toArray()).map((t) => t.name)).toEqual(["ローカル", "ローカル", "サーバー"])
  })

  it("60 秒のさかのぼりで重複して届いた行も、同じ行になる（冪等）", async () => {
    const row = tagRow(uuid(1), "a")
    const pull = vi.fn(async () => pullPage({ changes: { tags: [row, row], items: [], lists: [], listItems: [] } }))
    const { instance } = engine({ transport: { push: vi.fn(applyAll), pull } })
    await instance.sync()
    await instance.sync()
    expect(await database.tags.toArray()).toEqual([expect.objectContaining({ id: uuid(1), name: "a" })])
  })

  it("所属グループが変わったら、抜けたグループのデータを消してカーソルなしで取り直す", async () => {
    await setMeta(database, "cursor", "old")
    await setMeta(database, "groupIds", ["g1", "g2"])
    await database.items.add({ id: uuid(1), name: "g1", quantity: 1, tagIds: [], groupId: "g1", createdAt: new Date(0), updatedAt: new Date(0) })
    await database.items.add({ id: uuid(2), name: "g2", quantity: 1, tagIds: [], groupId: "g2", createdAt: new Date(0), updatedAt: new Date(0) })
    const pull = vi.fn<(input: SyncPullInput) => Promise<SyncPullOutput>>(async () => pullPage({ memberships: { groupIds: ["g2", "g3"] }, nextCursor: "new" }))
    const { instance } = engine({ transport: { push: vi.fn(applyAll), pull } })
    await instance.sync()
    expect(pull.mock.calls.map((c) => c[0].cursor)).toEqual(["old", undefined])
    expect((await database.items.toArray()).map((i) => i.groupId)).toEqual(["g2"])
    expect(await getMeta(database, "groupIds")).toEqual(["g2", "g3"])
    expect(await getMeta(database, "cursor")).toBe("new")
  })

  it("壊れたカーソル（BAD_REQUEST）は捨て、次の同期で最初から取る", async () => {
    await setMeta(database, "cursor", "broken")
    vi.spyOn(console, "error").mockImplementation(() => {})
    const pull = vi.fn().mockRejectedValueOnce(trpcError("BAD_REQUEST", 400)).mockResolvedValue(pullPage())
    const { instance } = engine({ transport: { push: vi.fn(applyAll), pull } })
    await instance.sync()
    expect(await getMeta(database, "cursor")).toBeUndefined()
    await instance.sync()
    expect(pull.mock.calls[1][0].cursor).toBeUndefined()
  })
})

describe("drain モード（NEXT_PUBLIC_LOCAL_FIRST=false）", () => {
  it("未送信のキューを送り切り、pull はしない", async () => {
    await database.syncQueue.bulkAdd([op(1), op(2)])
    const { instance, transport } = engine({ mode: "drain" })
    await instance.sync()
    expect(await queue()).toEqual([])
    expect(transport.pull).not.toHaveBeenCalled()
    await instance.sync()
    expect(transport.push).toHaveBeenCalledTimes(1)
  })
})

describe("同時実行の防止", () => {
  it("同時に呼んでも 1 本しか走らず、実行中に呼ばれた分は終わった後に 1 回だけ流す", async () => {
    let active = 0
    let maxActive = 0
    const pull = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active -= 1
      return pullPage()
    })
    const { instance } = engine({ transport: { push: vi.fn(applyAll), pull } })
    await Promise.all([instance.sync(), instance.sync(), instance.sync()])
    expect(maxActive).toBe(1)
    expect(pull).toHaveBeenCalledTimes(2)
  })

  it("タブ間は Web Locks で 1 本にする", async () => {
    const request = vi.fn(async (_name: string, callback: () => Promise<void>) => callback())
    const { instance } = engine({ locks: { request } })
    await instance.sync()
    expect(request).toHaveBeenCalledWith("sync-test", expect.any(Function))
  })

  it("止めた後は同期せず、start でまた動く（StrictMode の再マウント）", async () => {
    const { instance, transport } = engine()
    instance.stop()
    await instance.sync()
    expect(transport.pull).not.toHaveBeenCalled()
    await instance.start()
    await instance.sync()
    expect(transport.pull).toHaveBeenCalledTimes(1)
  })
})

describe("requestSync とその他", () => {
  it("ローカルへの書き込みの後、2 秒のデバウンスで同期する", async () => {
    const { instance, transport } = engine()
    instance.requestSync()
    instance.requestSync()
    expect(timers.map((t) => t.ms)).toEqual([PUSH_DEBOUNCE_MS, PUSH_DEBOUNCE_MS])
    timers[1].callback()
    await vi.waitFor(() => expect(transport.pull).toHaveBeenCalledTimes(1))
  })

  it("start で保存した時計のずれと最終同期を読み込み、件数を数える", async () => {
    await setMeta(database, "serverTimeOffset", 1234)
    await setMeta(database, "lastSyncAt", SERVER_TIME)
    await database.syncQueue.bulkAdd([op(1), op(2, { status: "failed" })])
    const listener = vi.fn()
    const { instance } = engine()
    instance.subscribe(listener)
    await instance.start()
    expect(instance.getClock().getOffset()).toBe(1234)
    expect(instance.getState()).toMatchObject({ lastSyncAt: new Date(SERVER_TIME), pendingCount: 1, failedCount: 1 })
    expect(listener).toHaveBeenCalled()
    instance.setOnline(false)
    expect(instance.getState().isOnline).toBe(false)
  })

  it("エラーの分類", () => {
    expect(classifySyncError(new TypeError("Failed to fetch"))).toBe("retry")
    expect(classifySyncError(trpcError("TOO_MANY_REQUESTS", 429))).toBe("retry")
    expect(classifySyncError(trpcError("UNAUTHORIZED", 401))).toBe("auth")
    expect(classifySyncError(trpcError("PRECONDITION_FAILED", 412, "CLIENT_TOO_OLD"))).toBe("tooOld")
    expect(classifySyncError(trpcError("BAD_REQUEST", 400))).toBe("invalid")
    expect(classifySyncError(trpcError("PRECONDITION_FAILED", 412, "other"))).toBe("retry")
    expect(classifySyncError(trpcError("FORBIDDEN", 403))).toBe("retry")
    expect(classifySyncError(trpcError("NOT_FOUND", 404))).toBe("retry")
  })

  it("push の結果の扱い", () => {
    const r = (status: "applied" | "partial" | "duplicate" | "conflict" | "rejected", reason?: string) => ({ opId: uuid(1), status, reason })
    expect(pushOutcome(r("applied"))).toBe("done")
    expect(pushOutcome(r("conflict", "deleted"))).toBe("done")
    expect(pushOutcome(r("rejected"))).toBe("failed")
    expect(pushOutcome(r("duplicate", "applied"))).toBe("done")
    expect(pushOutcome(r("duplicate", "conflict:deleted"))).toBe("refetch")
    expect(pushOutcome(r("duplicate", "rejected:not_found"))).toBe("failed")
  })
})

describe("所属グループのキャッシュ（#62 O7）", () => {
  const group = (id: string, name: string, memberCount: number) => ({
    id,
    name,
    inviteCode: "ABCD1234",
    inviteEnabled: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    memberCount,
  })

  async function cachedGroup(id: string, name: string) {
    await database.groups.put({ id, name, ownerId: "", createdAt: new Date(0), updatedAt: new Date(0), memberCount: 1 })
  }

  it("pull の後に所属グループでキャッシュを上書きする", async () => {
    await cachedGroup(uuid(1), "A（古い名前）")
    await cachedGroup(uuid(2), "B")
    const getGroups = vi.fn(async () => [group(uuid(1), "A", 2), group(uuid(3), "C", 3)])
    const { instance } = engine({ transport: { push: vi.fn(applyAll), pull: vi.fn(async () => pullPage()), getGroups } })

    await instance.sync()

    const rows = await database.groups.orderBy("id").toArray()
    expect(rows.map((r) => [r.id, r.name, r.memberCount, r.ownerId])).toEqual([
      [uuid(1), "A", 2, ""],
      [uuid(3), "C", 3, ""],
    ])
    expect(rows[0].createdAt).toEqual(new Date("2026-01-01T00:00:00.000Z"))
  })

  it("グループの一覧の取得に失敗しても同期は終わる", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await cachedGroup(uuid(1), "A")
    const getGroups = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    })
    const { instance } = engine({ transport: { push: vi.fn(applyAll), pull: vi.fn(async () => pullPage()), getGroups } })

    await instance.sync()

    expect(instance.getState().lastSyncAt).not.toBeNull()
    expect(await getMeta(database, "lastSyncAt")).toBeDefined()
    expect((await database.groups.toArray()).map((r) => r.name)).toEqual(["A"])
    expect(timers).toEqual([])
  })

  it("push だけの同期（drain）ではグループを取りにいかない", async () => {
    const getGroups = vi.fn(async () => [group(uuid(1), "A", 1)])
    const { instance } = engine({ mode: "drain", transport: { push: vi.fn(applyAll), pull: vi.fn(async () => pullPage()), getGroups } })

    await instance.sync()

    expect(getGroups).not.toHaveBeenCalled()
    expect(await database.groups.count()).toBe(0)
  })
})
