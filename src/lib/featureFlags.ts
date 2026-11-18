/**
 * ログイン中もローカルファーストで動かすか（offline-support.md「フィーチャーフラグ NEXT_PUBLIC_LOCAL_FIRST」）。
 * false（既定）のときは従来のサーバーファーストで、同期エンジンは未送信のキューを送り切るだけ（drain モード）。
 * NEXT_PUBLIC_ の値はビルド時に埋め込まれるので、process.env.NEXT_PUBLIC_LOCAL_FIRST をそのまま書く
 */
export function isLocalFirstEnabled(value: string | undefined = process.env.NEXT_PUBLIC_LOCAL_FIRST): boolean {
  return value === "true"
}
