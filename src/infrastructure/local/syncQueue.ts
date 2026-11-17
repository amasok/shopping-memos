import type { ShoppingMemosDB, SyncQueueItem } from "@/lib/db"
import { REQUEST_LIMITS, isWithinRecordBytes } from "@/shared/schemas/limits"
import type { SyncPushEntity, SyncPushOperationType } from "@/shared/schemas/sync"

/**
 * 同期キューへの積み方と圧縮（offline-support.md「キューの圧縮」）
 *
 * 同じエンティティの最後の操作が pending なら、次の操作とまとめる。
 * - create + update → create / update + update → update（パッチを統合。fieldTimes はフィールドごとに新しい方）
 * - create + delete → 両方消す / update + delete → delete
 * - 最後の操作が inflight（送信中）・failed、または複合操作のときはまとめずに積む
 *   （送信中の create と後からの delete を両方消すと、サーバーには作成だけが残るため）
 */

export interface NewOperation {
  entity: SyncPushEntity
  entityId: string
  type: SyncPushOperationType
  patch?: Record<string, unknown>
  fieldTimes?: Record<string, string>
  clientTime: string
}

export type QueuePlan =
  | { kind: "append" }
  /** last を merged に置き換える（積んだ順は last のまま） */
  | { kind: "merge"; merged: Pick<SyncQueueItem, "type" | "patch" | "fieldTimes" | "clientTime"> }
  /** last を消し、次の操作は積まない */
  | { kind: "dropBoth" }
  /** last を消し、次の操作を積む */
  | { kind: "replace" }

export class QueueLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "QueueLimitError"
  }
}

const later = (a: string, b: string): string => (Date.parse(b) >= Date.parse(a) ? b : a)

/** 2 つのパッチを統合する。フィールドごとに操作の時刻が新しい方の値を残す（同じ時刻なら後の操作） */
export function mergePatches(
  first: Pick<NewOperation, "patch" | "fieldTimes" | "clientTime">,
  second: Pick<NewOperation, "patch" | "fieldTimes" | "clientTime">
): Pick<SyncQueueItem, "patch" | "fieldTimes" | "clientTime"> {
  const patch: Record<string, unknown> = {}
  const fieldTimes: Record<string, string> = {}
  const keys = new Set([...Object.keys(first.patch ?? {}), ...Object.keys(second.patch ?? {})])
  for (const key of keys) {
    const inFirst = first.patch !== undefined && key in first.patch
    const inSecond = second.patch !== undefined && key in second.patch
    const firstTime = first.fieldTimes?.[key] ?? first.clientTime
    const secondTime = second.fieldTimes?.[key] ?? second.clientTime
    const useSecond = inSecond && (!inFirst || Date.parse(secondTime) >= Date.parse(firstTime))
    patch[key] = useSecond ? second.patch![key] : first.patch![key]
    fieldTimes[key] = inFirst && inSecond ? later(firstTime, secondTime) : useSecond ? secondTime : firstTime
  }
  return { patch, fieldTimes, clientTime: later(first.clientTime, second.clientTime) }
}

export function planEnqueue(last: SyncQueueItem | undefined, next: NewOperation): QueuePlan {
  if (!last || last.status !== "pending") return { kind: "append" }
  if (last.type === "create" && next.type === "update") {
    return { kind: "merge", merged: { type: "create", ...mergePatches(last, next) } }
  }
  if (last.type === "update" && next.type === "update") {
    return { kind: "merge", merged: { type: "update", ...mergePatches(last, next) } }
  }
  if (last.type === "create" && next.type === "delete") return { kind: "dropBoth" }
  if (last.type === "update" && next.type === "delete") return { kind: "replace" }
  return { kind: "append" }
}

/** sync.push の入力の上限（#72）。キューに積む前に同じ上限で確かめる（サーバーで拒否されて送れない操作を積まない） */
export function assertWithinPushLimits(op: Pick<NewOperation, "patch" | "fieldTimes">): void {
  if (op.patch && !isWithinRecordBytes(op.patch)) {
    throw new QueueLimitError(`1 件のデータは ${REQUEST_LIMITS.recordBytes} バイト以内です`)
  }
  if (op.fieldTimes && Object.keys(op.fieldTimes).length > REQUEST_LIMITS.pushFieldTimes) {
    throw new QueueLimitError(`fieldTimes は ${REQUEST_LIMITS.pushFieldTimes} 件までです`)
  }
}

/**
 * キューに積む（圧縮つき）。呼び出し元のトランザクションに syncQueue を含めること（エンティティの書き込みと同時に記録する）
 */
export async function enqueue(database: ShoppingMemosDB, op: NewOperation): Promise<void> {
  const sameEntity = await database.syncQueue
    .where("entityId")
    .equals(op.entityId)
    .filter((q) => q.entity === op.entity)
    .sortBy("seq")
  const last = sameEntity.at(-1)
  const plan = planEnqueue(last, op)

  if (plan.kind === "merge") {
    const merged = { ...last!, ...plan.merged }
    assertWithinPushLimits(merged)
    await database.syncQueue.put(merged)
    return
  }
  assertWithinPushLimits(op)
  if (plan.kind === "dropBoth" || plan.kind === "replace") await database.syncQueue.delete(last!.id)
  if (plan.kind === "dropBoth") return

  const tail = await database.syncQueue.orderBy("seq").last()
  await database.syncQueue.add({
    id: crypto.randomUUID(),
    seq: (tail?.seq ?? 0) + 1,
    ...op,
    retryCount: 0,
    status: "pending",
  })
}
