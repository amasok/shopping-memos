/**
 * サーバーの時刻で補正した時計（offline-support.md「競合解決」）。
 * 操作の時刻（clientTime / fieldTimes / updatedAt）は、端末の時計のずれを sync の serverTime で補正して記録する
 */
export interface Clock {
  /** 補正済みの現在時刻 */
  now(): Date
  /** サーバーの時刻 - 端末の時刻（ミリ秒） */
  getOffset(): number
  setOffset(offsetMs: number): void
}

/**
 * serverTime から、時計のずれを計算する。サーバーが時刻を取ったのは、送ってから受け取るまでの真ん中とみなす
 */
export function computeServerTimeOffset(serverTime: string, sentAtMs: number, receivedAtMs: number): number {
  const server = Date.parse(serverTime)
  if (Number.isNaN(server)) return 0
  return Math.round(server - (sentAtMs + receivedAtMs) / 2)
}

export function createClock(offsetMs = 0, deviceNow: () => number = Date.now): Clock {
  let offset = offsetMs
  return {
    now: () => new Date(deviceNow() + offset),
    getOffset: () => offset,
    setOffset: (value) => {
      offset = value
    },
  }
}
