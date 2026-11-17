import { NextResponse } from "next/server"
import { getTestMailbox } from "@/infrastructure/auth/email"
import { isE2ERequestAllowed } from "@/lib/e2e/guard"
import { normalizeEmail } from "@/shared/schemas/email"

/**
 * E2E 用: 直近に送った OTP を返す（#61 A3a 5.1。design の D8）
 *
 * - ビルド時: ファイル名が `route.e2e.ts` なので、`E2E_BUILD=true` のビルドにだけ含まれる
 * - 実行時: `E2E_TEST`・`VERCEL_ENV`・`x-e2e-token` の条件がそろわなければ 404（NODE_ENV では判断しない）
 * - コードは TestMailboxEmailSender（globalThis の Map）が持つ。E2E のサーバーは 1 プロセスで動かす
 *
 * GET /api/test/otp?email=<アドレス> → { otp, sentAt, now }（まだなければ otp は null）。
 * now はサーバーの時刻（ログインのヘルパーが、再送の間隔の 60 秒を待つのに使う）
 */
export async function GET(request: Request) {
  if (!isE2ERequestAllowed(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const email = normalizeEmail(new URL(request.url).searchParams.get("email"))
  if (!email) return NextResponse.json({ error: "Bad request" }, { status: 400 })

  const latest = getTestMailbox().latestOtp(email)
  return NextResponse.json(
    {
      otp: latest?.otp ?? null,
      sentAt: latest?.sentAt.toISOString() ?? null,
      now: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } }
  )
}
