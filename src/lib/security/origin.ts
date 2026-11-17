/**
 * 別のオリジンからの POST を断る（#61 A3a 3.1。change 61-a3-email-otp-login の design の D6。#71 の残り）
 *
 * tRPC の route と認証の route の POST にかける。Cookie の有無にかかわらず、次のどれかなら断る（呼ぶ側で 403）:
 * - `Origin` があり、信頼するオリジン（BETTER_AUTH_URL と BETTER_AUTH_TRUSTED_ORIGINS）のどれとも違う（`null` を含む）
 * - `Sec-Fetch-Site` が `cross-site`
 * `Origin` も `Sec-Fetch-Site` もないリクエストは通す（ブラウザ以外。Cookie を持たないので CSRF にならない）
 */

function toOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return url.origin === "null" ? null : url.origin
  } catch {
    return null
  }
}

export function isSameOriginRequest(request: Request, trustedOrigins: readonly string[]): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false

  const origin = request.headers.get("origin")
  if (origin === null) return true

  const actual = toOrigin(origin)
  if (!actual) return false
  return trustedOrigins.some((trusted) => toOrigin(trusted) === actual)
}

/** 断るときの応答 */
export function crossOriginResponse(): Response {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  })
}
