import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/** ビルド時刻と、強制更新の最低リリース番号を返す（SW では NetworkOnly） */
export function GET() {
  const minClientRelease = Number(process.env.MIN_CLIENT_RELEASE ?? 0) || 0
  const buildTime = Number(process.env.NEXT_PUBLIC_BUILD_TIME ?? 0) || 0
  return NextResponse.json(
    { buildTime, minClientRelease },
    { headers: { "Cache-Control": "no-store" } }
  )
}
