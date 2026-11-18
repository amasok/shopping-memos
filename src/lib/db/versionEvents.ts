import type Dexie from "dexie"

/**
 * Dexie のバージョン更新の扱い（#62 O6。offline-support.md「Dexie のバージョン更新」）
 * - 古いタブ: 新しいバージョンで開かれようとしたら（versionchange）、DB を閉じてリロードする
 * - 新しいタブ: 古いタブが閉じるのを待っている間（blocked）、「他のタブを閉じてください」を出す
 */

let blocked = false
const listeners = new Set<() => void>()

function setBlocked(value: boolean): void {
  if (blocked === value) return
  blocked = value
  listeners.forEach((listener) => listener())
}

/** 古いタブが閉じるのを待っているか */
export function isDbBlocked(): boolean {
  return blocked
}

export function subscribeDbBlocked(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function reloadPage(): void {
  if (typeof window !== "undefined") window.location.reload()
}

export function attachVersionHandlers(database: Dexie, reload: () => void = reloadPage): void {
  database.on("versionchange", () => {
    database.close()
    reload()
    return false
  })
  database.on("blocked", () => setBlocked(true))
  database.on("ready", () => setBlocked(false), true)
}
