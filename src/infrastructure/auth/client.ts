import { createAuthClient } from "better-auth/react"
import { emailOTPClient } from "better-auth/client/plugins"

/**
 * Better Auth のクライアント（#61 A3a 4.1。design の D2）
 *
 * 呼ぶのは /api/auth の許可リストのパス（送信・照合・セッションの取得・ログアウト）だけ。
 * baseURL は省略し、開いているオリジンの /api/auth を使う。A5 で passkeyClient を足す
 */
export const authClient = createAuthClient({
  plugins: [emailOTPClient()],
})
