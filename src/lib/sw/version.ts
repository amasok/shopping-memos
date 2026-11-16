/** ページと SW の間で送る「待機中の SW を有効にする」メッセージ */
export const SKIP_WAITING_MESSAGE = "SKIP_WAITING"

export interface VersionInfo {
  buildTime: number
  minClientRelease: number
}

/** このビルドのリリース番号（ビルド時刻）。未設定（開発環境）は 0 */
export function getClientRelease(): number {
  return Number(process.env.NEXT_PUBLIC_BUILD_TIME ?? 0) || 0
}

/** 自分のリリース番号が最低リリース番号を下回っているか（minClientRelease が 0 以下なら強制しない） */
export function isBelowMinRelease(
  clientRelease: number,
  minClientRelease: number,
): boolean {
  return minClientRelease > 0 && clientRelease < minClientRelease
}

export function parseVersionInfo(data: unknown): VersionInfo | null {
  if (typeof data !== "object" || data === null) return null
  const { buildTime, minClientRelease } = data as Record<string, unknown>
  if (typeof buildTime !== "number" || typeof minClientRelease !== "number")
    return null
  return { buildTime, minClientRelease }
}

/** /api/version を取得する。オフラインや失敗時は null（強制更新しない） */
export async function fetchVersionInfo(): Promise<VersionInfo | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" })
    if (!res.ok) return null
    return parseVersionInfo(await res.json())
  } catch {
    return null
  }
}
