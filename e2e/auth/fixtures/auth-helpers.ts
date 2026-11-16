import { type Page } from "@playwright/test"
import { e2eHeaders, getUser } from "./db-helpers"

/** E2Eテスト用のユーザーメールアドレス */
export const USER_A_EMAIL = "user-a@e2e-test.local"
export const USER_B_EMAIL = "user-b@e2e-test.local"

/** storageState ファイルパス */
export const USER_A_STORAGE = "e2e/.auth/user-a.json"
export const USER_B_STORAGE = "e2e/.auth/user-b.json"

/**
 * Credentials プロバイダでログインし、storageState を保存
 *
 * カスタムログインページ（/login）にはGoogle用のUIしかないため、
 * NextAuth REST API を直接叩いてCredentials認証を行う。
 * 1. GET /api/auth/csrf → CSRFトークン取得
 * 2. POST /api/auth/callback/credentials → 認証実行（Set-Cookie でセッション取得）
 *    E2E 用のログインは x-e2e-token ヘッダが必要（#70）
 */
/**
 * Credentials プロバイダでログインする（セッションの Cookie がブラウザのコンテキストに入る）。
 * merge 済みの印は付けないので、次に画面を開くと DataMergeContext がゲストのデータを merge する
 */
export async function loginWithCredentials(page: Page, email: string): Promise<void> {
  // 1. CSRFトークン取得（ブラウザ経由でcookieもセットさせる）
  await page.goto("/api/auth/csrf")
  const csrfResponse = await page.evaluate(() =>
    document.body.innerText
  )
  const { csrfToken } = JSON.parse(csrfResponse)

  // 2. Credentials プロバイダで認証（POST）
  // page.goto で POST はできないので、page.evaluate 内で fetch を使う
  await page.evaluate(
    async ({ csrfToken, email, headers }) => {
      const res = await fetch("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
        body: new URLSearchParams({
          csrfToken,
          email,
        }),
        redirect: "follow",
      })
      // セッションcookieがセットされる
      if (!res.ok && res.status !== 302 && res.status !== 200) {
        throw new Error(`Auth failed: ${res.status}`)
      }
    },
    { csrfToken, email, headers: e2eHeaders() }
  )
}

export async function loginAndSaveState(
  page: Page,
  email: string,
  storagePath: string
): Promise<string> {
  await loginWithCredentials(page, email)

  // 3. ホームに遷移してセッション確認
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  // 以前の仕組みからの移行（ゲストのデータの扱いのバージョン）が済むのを待つ。
  // 済む前に印を付けて保存すると、各テストの最初の読み込みで、印が以前の意味の印として扱われる
  await page.waitForFunction(() => localStorage.getItem("guest-data-version") === "2")

  // 4. ユーザーIDを取得（seed APIを使用）
  const { id: userId } = await getUser(email)

  // 5. DataMerge をスキップするための localStorage 設定
  await page.evaluate((uid) => {
    localStorage.setItem(`data-merge-completed-${uid}`, "true")
  }, userId)

  // 6. storageState を保存
  await page.context().storageState({ path: storagePath })

  return userId
}
