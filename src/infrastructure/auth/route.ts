import { isSameOriginRequest, crossOriginResponse } from "@/lib/security/origin"
import { SEND_OTP_PATH, SIGN_IN_OTP_PATH } from "./server"

/**
 * 認証の route（/api/auth/*）の入口（#61 A3a 3.2。design の D4「使わない API を閉じる」・D6）
 *
 * - 許可リストにあるパスとメソッドだけを Better Auth に渡し、ほかは 404（ライブラリが新しいパスを足しても自動では開かない）
 * - POST は、別のオリジンからなら 403（Cookie の有無にかかわらず。ログインの CSRF を防ぐ）
 * - コードの送信は、種類が sign-in 以外なら 400（hooks でも重ねて断る）
 * A5（パスキー）は、その change で許可リストに足す
 */

export const AUTH_BASE_PATH = "/api/auth"

export const ALLOWED_AUTH_PATHS: Readonly<Record<string, readonly string[]>> = {
  GET: ["/get-session"],
  // すべての端末からログアウト（#61 A4。有効なセッションが要る。ユーザーの更新の /update-user は開かない）
  POST: [SEND_OTP_PATH, SIGN_IN_OTP_PATH, "/sign-out", "/revoke-sessions"],
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

export interface AuthRouteDeps {
  handle: (request: Request) => Promise<Response>
  trustedOrigins: () => readonly string[]
}

export function createAuthRouteHandler({ handle, trustedOrigins }: AuthRouteDeps) {
  return async function authRoute(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    const path = pathname.startsWith(`${AUTH_BASE_PATH}/`) ? pathname.slice(AUTH_BASE_PATH.length) : null
    if (!path || !ALLOWED_AUTH_PATHS[request.method]?.includes(path)) {
      return jsonResponse(404, { error: "Not Found" })
    }

    if (request.method === "POST") {
      if (!isSameOriginRequest(request, trustedOrigins())) return crossOriginResponse()
      if (path === SEND_OTP_PATH) {
        const body: unknown = await request
          .clone()
          .json()
          .catch(() => null)
        if (typeof body !== "object" || body === null || (body as { type?: unknown }).type !== "sign-in") {
          return jsonResponse(400, { code: "INVALID_OTP_TYPE", message: "Invalid OTP type" })
        }
      }
    }
    return handle(request)
  }
}
