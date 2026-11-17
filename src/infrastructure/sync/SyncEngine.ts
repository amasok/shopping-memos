import type { ShoppingMemosDB, SyncQueueItem } from "@/lib/db"
import { deleteMeta, getMeta, setMeta } from "@/lib/db/meta"
import { REQUEST_LIMITS } from "@/shared/schemas/limits"
import {
  CLIENT_TOO_OLD,
  SYNC_PROTOCOL_VERSION,
  type SyncPullInput,
  type SyncPullOutput,
  type SyncPushInput,
  type SyncPushOutput,
  type SyncPushResult,
} from "@/shared/schemas/sync"
import { computeServerTimeOffset, createClock, type Clock } from "@/infrastructure/local/clock"
import { TABLE_OF, applyServerChanges, removeGroupData } from "./applyServerRows"

/**
 * クライアントの同期エンジン（offline-support.md「SyncEngine」。#62 O6）
 *
 * - push: pending の操作を積んだ順に 100 件ずつ送る。applied / partial / conflict はキューから消し（partial と conflict は
 *   serverRow をローカルに反映）、rejected は failed にする。duplicate は reason（最初に処理したときの結果）で分ける
 * - pull: hasMore が false になるまでカーソルで取る。所属グループが変わったら、抜けたグループのデータを消してカーソルなしで取り直す
 * - ネットワークエラー・5xx は指数バックオフ（2 秒〜5 分）、401 はセッション切れで止まる、CLIENT_TOO_OLD でも止まる
 * - 同期は 1 本だけ（タブの中は実行中の Promise、タブ間は Web Locks）
 * - drain モード（NEXT_PUBLIC_LOCAL_FIRST=false）: push だけ（未送信のキューを送り切る）。pull はしない
 */

export interface SyncTransport {
  push(input: SyncPushInput): Promise<SyncPushOutput>
  pull(input: SyncPullInput): Promise<SyncPullOutput>
}

export type SyncMode = "full" | "drain"

export interface SyncEngineState {
  isOnline: boolean
  isSyncing: boolean
  pendingCount: number
  failedCount: number
  lastSyncAt: Date | null
  sessionExpired: boolean
  clientTooOld: boolean
}

interface LockManagerLike {
  request(name: string, callback: () => Promise<void>): Promise<void>
}

export interface SyncEngineOptions {
  db: ShoppingMemosDB
  transport: SyncTransport
  mode: SyncMode
  /** Web Locks の名前（ユーザーごと） */
  lockName: string
  clock?: Clock
  /** 既定は navigator.locks（null で使わない） */
  locks?: LockManagerLike | null
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
  /** conflict でローカルをサーバーの値に戻したとき（トーストを出す） */
  onConflict?: (result: SyncPushResult) => void
}

export const BACKOFF_MIN_MS = 2_000
export const BACKOFF_MAX_MS = 5 * 60_000
/** ローカルへの書き込み後、push するまでのデバウンス */
export const PUSH_DEBOUNCE_MS = 2_000

type ErrorKind = "retry" | "auth" | "tooOld" | "client"

export function classifySyncError(error: unknown): ErrorKind {
  const data = (error as { data?: { code?: string; httpStatus?: number } } | null)?.data
  // data がないのは、レスポンスが届かなかった（ネットワークエラー）とき
  if (!data) return "retry"
  if (data.code === "UNAUTHORIZED" || data.httpStatus === 401) return "auth"
  if (data.code === "PRECONDITION_FAILED" && error instanceof Error && error.message.includes(CLIENT_TOO_OLD)) return "tooOld"
  if ((data.httpStatus ?? 500) >= 500 || data.httpStatus === 429) return "retry"
  return "client"
}

class SyncStop extends Error {
  constructor(readonly kind: ErrorKind, readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original))
  }
}

export class SyncEngine {
  private state: SyncEngineState = {
    isOnline: typeof navigator === "undefined" ? true : (navigator.onLine ?? true),
    isSyncing: false,
    pendingCount: 0,
    failedCount: 0,
    lastSyncAt: null,
    sessionExpired: false,
    clientTooOld: false,
  }
  private readonly listeners = new Set<() => void>()
  private readonly clock: Clock
  private running: Promise<void> | null = null
  private rerun = false
  private stopped = false
  private attempt = 0
  private retryTimer: unknown = null
  private debounceTimer: unknown = null
  /** push の duplicate（partial / conflict）で、最新の行をカーソルなしで取り直す */
  private needsFullPull = false

  constructor(private readonly options: SyncEngineOptions) {
    this.clock = options.clock ?? createClock()
  }

  getState = (): SyncEngineState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getClock(): Clock {
    return this.clock
  }

  private setState(patch: Partial<SyncEngineState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  /** 保存してある時計のずれ・最終同期を読み込む（stop の後に呼ぶと、また動く） */
  async start(): Promise<void> {
    this.stopped = false
    const [offset, lastSyncAt] = await Promise.all([
      getMeta(this.options.db, "serverTimeOffset"),
      getMeta(this.options.db, "lastSyncAt"),
    ])
    if (offset !== undefined) this.clock.setOffset(offset)
    this.setState({ lastSyncAt: lastSyncAt ? new Date(lastSyncAt) : null })
    await this.refreshCounts()
  }

  stop(): void {
    this.stopped = true
    this.clearTimer("retryTimer")
    this.clearTimer("debounceTimer")
  }

  setOnline(isOnline: boolean): void {
    this.setState({ isOnline })
  }

  /** ローカルへの書き込みの後に呼ぶ（2 秒のデバウンスで同期する） */
  requestSync(): void {
    void this.refreshCounts()
    this.clearTimer("debounceTimer")
    this.debounceTimer = this.timer(() => void this.sync(), PUSH_DEBOUNCE_MS)
  }

  /** push → pull（drain モードは push だけ）。実行中に呼ばれたら、終わった後にもう 1 回だけ流す */
  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.running) {
      this.rerun = true
      return this.running
    }
    this.running = this.loop().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async loop(): Promise<void> {
    this.setState({ isSyncing: true })
    try {
      do {
        this.rerun = false
        await this.withLock(() => this.runOnce())
      } while (this.rerun && !this.stopped)
    } finally {
      this.setState({ isSyncing: false })
      await this.refreshCounts()
    }
  }

  private withLock(fn: () => Promise<void>): Promise<void> {
    const locks: LockManagerLike | null =
      this.options.locks !== undefined
        ? this.options.locks
        : typeof navigator !== "undefined" && navigator.locks
          ? (navigator.locks as unknown as LockManagerLike)
          : null
    return locks ? locks.request(this.options.lockName, fn) : fn()
  }

  private async runOnce(): Promise<void> {
    if (this.stopped || this.state.sessionExpired || this.state.clientTooOld) return
    this.clearTimer("retryTimer")
    try {
      await this.push()
      if (this.options.mode === "full") await this.pull()
      this.attempt = 0
      this.setState({ isOnline: true })
    } catch (error) {
      if (error instanceof SyncStop) this.handleError(error.kind, error.original)
      else this.handleError(classifySyncError(error), error)
    }
  }

  private handleError(kind: ErrorKind, error: unknown): void {
    if (kind === "auth") return this.setState({ sessionExpired: true })
    if (kind === "tooOld") return this.setState({ clientTooOld: true })
    if (kind === "retry") {
      if (!(error as { data?: unknown })?.data) this.setState({ isOnline: false })
      const delay = Math.min(BACKOFF_MIN_MS * 2 ** this.attempt, BACKOFF_MAX_MS)
      this.attempt += 1
      this.retryTimer = this.timer(() => void this.sync(), delay)
      return
    }
    console.error("Sync failed:", error)
  }

  // ---- push ----

  private async push(): Promise<void> {
    const { db } = this.options
    // 前の実行が途中で止まって送信中のまま残った操作を戻す（ロックの中なので、ほかに送信中のものはない）
    await db.syncQueue.where("status").equals("inflight").modify({ status: "pending" })
    for (;;) {
      if (this.stopped) return
      // 取り出しと inflight への変更は 1 つのトランザクションにする（間に積まれた操作が、送る前の pending の操作に
      // まとめられて、送らずに消えるのを防ぐ。inflight の操作は圧縮の対象から外れる）
      const batch = await db.transaction("rw", db.syncQueue, async () => {
        const pending = await db.syncQueue
          .orderBy("seq")
          .filter((op) => op.status === "pending")
          .limit(REQUEST_LIMITS.pushOperations)
          .toArray()
        await db.syncQueue.bulkPut(pending.map((op) => ({ ...op, status: "inflight" as const })))
        return pending
      })
      if (batch.length === 0) return
      const ids = batch.map((op) => op.id)

      let output: SyncPushOutput
      const sentAt = Date.now()
      try {
        output = await this.options.transport.push({
          protocolVersion: SYNC_PROTOCOL_VERSION,
          operations: batch.map(toPushOperation),
        })
      } catch (error) {
        const kind = classifySyncError(error)
        // サーバーが入力ごと拒否した操作は、送り直しても通らない。failed にしてキューを止めない
        const failed = kind === "client"
        await db.syncQueue
          .where("id")
          .anyOf(ids)
          .modify((op) => {
            op.status = failed ? "failed" : "pending"
            if (failed) op.lastError = error instanceof Error ? error.message : String(error)
            else op.retryCount += 1
          })
        throw new SyncStop(kind, error)
      }
      this.updateOffset(output.serverTime, sentAt)
      const processed = await this.applyPushResults(batch, output.results)
      await this.refreshCounts()
      if (processed === 0) {
        // 1 件も結果が返らなかった。同じ操作を送り続けないよう、バックオフして再試行する
        throw new SyncStop("retry", Object.assign(new Error("push の結果が返りませんでした"), { data: { httpStatus: 500 } }))
      }
    }
  }

  /** 結果を反映し、処理できた（pending に戻さなかった）件数を返す */
  private async applyPushResults(batch: SyncQueueItem[], results: SyncPushResult[]): Promise<number> {
    const { db } = this.options
    const byOpId = new Map(results.map((r) => [r.opId, r]))
    const done: string[] = []
    const rows: SyncPushResult[] = []
    let retried = 0
    await db.transaction("rw", [db.syncQueue, db.tags, db.items, db.lists, db.listItems], async () => {
      for (const op of batch) {
        const result = byOpId.get(op.id)
        const outcome = result ? pushOutcome(result) : "retry"
        if (outcome === "retry") {
          retried += 1
          await db.syncQueue.update(op.id, { status: "pending" })
        } else if (outcome === "failed") {
          await db.syncQueue.update(op.id, { status: "failed", lastError: result?.reason ?? result?.status })
        } else {
          done.push(op.id)
          if (outcome === "refetch") this.needsFullPull = true
          if (result?.serverRow && (result.status === "partial" || result.status === "conflict")) rows.push(result)
        }
      }
      await db.syncQueue.bulkDelete(done)
      const opOf = new Map(batch.map((op) => [op.id, op]))
      for (const result of rows) {
        const op = opOf.get(result.opId)!
        await applyServerChanges(db, { [TABLE_OF[op.entity]]: [result.serverRow!] })
      }
    })
    for (const result of rows) if (result.status === "conflict") this.options.onConflict?.(result)
    return batch.length - retried
  }

  // ---- pull ----

  private async pull(): Promise<void> {
    const { db } = this.options
    const previousGroups = await getMeta(db, "groupIds")
    let cursor = this.needsFullPull ? undefined : await getMeta(db, "cursor")
    this.needsFullPull = false
    let firstPage = true
    for (;;) {
      if (this.stopped) return
      const sentAt = Date.now()
      let page: SyncPullOutput
      try {
        page = await this.options.transport.pull({ cursor, protocolVersion: SYNC_PROTOCOL_VERSION })
      } catch (error) {
        // 壊れたカーソル（BAD_REQUEST）は捨てて、次の同期でカーソルなしで取り直す
        if (cursor !== undefined && classifySyncError(error) === "client") await deleteMeta(db, "cursor")
        throw error
      }
      this.updateOffset(page.serverTime, sentAt)

      if (firstPage && previousGroups) {
        firstPage = false
        const current = new Set(page.memberships.groupIds)
        const removed = previousGroups.filter((id) => !current.has(id))
        const changed = removed.length > 0 || current.size !== previousGroups.length
        await removeGroupData(db, removed)
        if (changed && cursor !== undefined) {
          // グループの削除で FK が SET NULL になった行は updated_at が変わらないので、カーソルなしで取り直す（O5）
          await setMeta(db, "groupIds", page.memberships.groupIds)
          await deleteMeta(db, "cursor")
          cursor = undefined
          continue
        }
      }
      firstPage = false

      await applyServerChanges(db, page.changes)
      await setMeta(db, "cursor", page.nextCursor)
      await setMeta(db, "groupIds", page.memberships.groupIds)
      cursor = page.nextCursor
      if (!page.hasMore) break
    }
    const now = this.clock.now()
    await setMeta(db, "lastSyncAt", now.toISOString())
    this.setState({ lastSyncAt: now })
  }

  // ---- 補助 ----

  private updateOffset(serverTime: string, sentAt: number): void {
    const offset = computeServerTimeOffset(serverTime, sentAt, Date.now())
    this.clock.setOffset(offset)
    void setMeta(this.options.db, "serverTimeOffset", offset)
  }

  private async refreshCounts(): Promise<void> {
    const { db } = this.options
    const [pendingCount, failedCount] = await Promise.all([
      db.syncQueue.where("status").anyOf("pending", "inflight").count(),
      db.syncQueue.where("status").equals("failed").count(),
    ])
    if (pendingCount !== this.state.pendingCount || failedCount !== this.state.failedCount) {
      this.setState({ pendingCount, failedCount })
    }
  }

  private timer(callback: () => void, ms: number): unknown {
    return (this.options.setTimer ?? setTimeout)(callback, ms)
  }

  private clearTimer(name: "retryTimer" | "debounceTimer"): void {
    if (this[name] !== null) (this.options.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)))(this[name])
    this[name] = null
  }
}

function toPushOperation(op: SyncQueueItem): SyncPushInput["operations"][number] {
  return {
    opId: op.id,
    entity: op.entity,
    entityId: op.entityId,
    type: op.type,
    clientTime: op.clientTime,
    ...(op.patch ? { patch: op.patch } : {}),
    ...(op.fieldTimes ? { fieldTimes: op.fieldTimes } : {}),
  }
}

/**
 * 結果ごとの扱い。duplicate は reason（最初に処理したときの結果）で分ける（O4。設計書）:
 * applied → 消す、partial / conflict → 消して最新の行を取り直す、rejected → failed
 */
export function pushOutcome(result: SyncPushResult): "done" | "refetch" | "failed" | "retry" {
  switch (result.status) {
    case "applied":
    case "partial":
    case "conflict":
      return "done"
    case "rejected":
      return "failed"
    case "duplicate": {
      const reason = result.reason ?? ""
      if (reason === "applied") return "done"
      if (reason.startsWith("rejected")) return "failed"
      return "refetch"
    }
    default:
      return "retry"
  }
}
