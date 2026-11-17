/**
 * ログインの後の戻り先（callbackUrl）の検証（#61 A3a 4.2。design の D5）
 *
 * `new URL(value, origin)` の origin がアプリのオリジンと同じときだけ、その pathname + search + hash を返す。
 * ほか（別のサイト、`//evil.example`、`/\evil.example`、タブ・改行を含む値、javascript: など）はホーム（/）
 */
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/

export function safeCallbackPath(value: string | null | undefined, origin: string): string {
  if (!value || CONTROL_OR_BACKSLASH.test(value)) return "/"
  try {
    const url = new URL(value, origin)
    if (url.origin !== new URL(origin).origin) return "/"
    const path = `${url.pathname}${url.search}${url.hash}`
    // ログイン画面に戻すと、ログインの後にまたログイン画面が出るのでホームにする
    return url.pathname === "/login" ? "/" : path
  } catch {
    return "/"
  }
}

/** ログイン画面の URL（今いる画面を戻り先にする） */
export function loginUrl(currentPath: string): string {
  return currentPath && currentPath !== "/" ? `/login?callbackUrl=${encodeURIComponent(currentPath)}` : "/login"
}
