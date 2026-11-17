/**
 * 全ルートに付けるセキュリティヘッダ（#71）
 *
 * CSP は 2 本立てにする。
 * - 強制（Content-Security-Policy）: 通常の画面を壊さない指令だけ
 *   （クリックジャッキング対策の frame-ancestors、object-src、base-uri）
 * - 報告のみ（Content-Security-Policy-Report-Only）: 目標とする全体のポリシー。
 *   違反はブラウザのコンソールに出るだけで、動作は止めない。E2E で違反が出ないことを確認してから強制に切り替える
 *
 * Next.js のインラインスクリプトがあるため script-src は 'unsafe-inline' を許可する。
 * nonce 方式は middleware と動的レンダリングが必要で、静的化したページ（#62 O2）や SW のプリキャッシュと両立しない。
 *
 * 守ること（設計書）:
 * - Service Worker（Serwist）: worker-src 'self'（offline-support.md「#71」）
 * - パスキー: Permissions-Policy で publickey-credentials-get / create を self で許可（passkey-email-auth.md「#71」）
 * - OGP 画像: 他サイトの画像を <img> で直接読むため img-src に https: を許可
 */

export type Header = { key: string; value: string }

type Options = { isDev: boolean }

type Directives = Record<string, string[]>

/** Cloudflare Turnstile（#61 A3a 4.4。design の D9） */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com"

function serialize(directives: Directives): string {
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(" "))
    .join("; ")
}

/** 強制する CSP。通常の画面の動作に影響しない指令だけ */
export function buildEnforcedCsp(): string {
  return serialize({
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
  })
}

/** 報告のみの CSP（将来強制にする目標のポリシー） */
export function buildReportOnlyCsp({ isDev }: Options): string {
  return serialize({
    "default-src": ["'self'"],
    // 開発時は React の開発ビルドが eval を使う
    // Turnstile（#61 A3a。ログイン画面の非表示のウィジェット）のスクリプト
    "script-src": ["'self'", "'unsafe-inline'", TURNSTILE_ORIGIN, ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    // OGP 画像は任意の https の URL。data: / blob: はアイコンやプレビュー用
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    // 開発時は HMR の WebSocket
    "connect-src": ["'self'", ...(isDev ? ["ws:"] : [])],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    // Turnstile のウィジェットは iframe
    "frame-src": [TURNSTILE_ORIGIN],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    // ログイン画面の <form> は fetch で送る（preventDefault）ので外部へは送らない。<form> で外部へ送る画面を作るときは見直す
    "form-action": ["'self'"],
  })
}

/** 使わない機能を止める。パスキー（WebAuthn）は self で許可する */
export const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "publickey-credentials-get=(self)",
  "publickey-credentials-create=(self)",
].join(", ")

export function buildSecurityHeaders({ isDev }: Options): Header[] {
  return [
    { key: "Content-Security-Policy", value: buildEnforcedCsp() },
    { key: "Content-Security-Policy-Report-Only", value: buildReportOnlyCsp({ isDev }) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    // Vercel も付けるが、ホスティングを移しても維持されるよう明示する。
    // preload はサブドメイン（shopping.counoco.net）では登録できないため付けない
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ]
}
