import { expect, type Page } from "@playwright/test"
import { E2E_ORIGIN } from "../../ports"
import { e2eHeaders, getUser } from "./db-helpers"

/** E2Eテスト用のユーザーメールアドレス */
export const USER_A_EMAIL = "user-a@e2e-test.local"
export const USER_B_EMAIL = "user-b@e2e-test.local"
/**
 * 大量のデータ（上限ちょうどの 1000 件など）を入れるテスト専用のユーザー（#170）。
 * 共有のユーザー A に入れると、その後に流れる画面のテスト（ホームの一覧の表示待ち）が遅くなって落ちるため、分ける
 */
export const USER_BULK_EMAIL = "user-bulk@e2e-test.local"

/** storageState ファイルパス */
export const USER_A_STORAGE = "e2e/.auth/user-a.json"
export const USER_B_STORAGE = "e2e/.auth/user-b.json"
export const USER_BULK_STORAGE = "e2e/.auth/user-bulk.json"

/** Cloudflare の Turnstile のテスト用のトークン（E2E はテスト用の secret なので、空でなければ通る） */
const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX"
/** サーバーの再送の間隔（同じアドレスへの送信は 60 秒に 1 回。E2E でも制限は外さない） */
const RESEND_INTERVAL_MS = 60_000

let ipSeq = 0
/**
 * ログインのたびに別の IP（x-real-ip）を使い、IP ごとの上限（送信 3 通/分・20 通/日）に当たらないようにする
 * （ローカルと CI は Vercel ではないので、ヘッダがそのまま届く。design の D8）
 */
function nextTestIp(): string {
  ipSeq += 1
  const run = process.pid % 250
  return `10.${run}.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`
}

type OtpState = { otp: string | null; sentAt: string | null; now: string }

async function readOtp(page: Page, email: string): Promise<OtpState> {
  const res = await page.request.get(`${E2E_ORIGIN}/api/test/otp?email=${encodeURIComponent(email)}`, {
    headers: e2eHeaders(),
  })
  if (!res.ok()) throw new Error(`テスト用のルートに失敗しました: ${res.status()}`)
  return res.json()
}

/**
 * メールのコードでログインする（#61 A3a 5.2）。セッションの Cookie がブラウザのコンテキストに入る
 *
 * 1. コードを送る（POST /api/auth/email-otp/send-verification-otp）
 * 2. テスト用のルート（GET /api/test/otp）から、送ったコードを読む（TestMailboxEmailSender が持つ）
 * 3. コードでログインする（POST /api/auth/sign-in/email-otp）
 * 同じアドレスに 60 秒以内に送ると、サーバーは黙って送らない（再送の間隔）。そのときは残りの時間だけ待ってから送る。
 * merge 済みの印は付けないので、次に画面を開くと DataMergeContext がゲストのデータを merge する
 */
export async function loginWithOtp(
  page: Page,
  email: string,
  options: { displayName?: string | null } = {}
): Promise<void> {
  const ip = nextTestIp()
  const headers = { "content-type": "application/json", origin: E2E_ORIGIN, "x-real-ip": ip }

  const before = await readOtp(page, email)
  if (before.sentAt) {
    const elapsed = new Date(before.now).getTime() - new Date(before.sentAt).getTime()
    if (elapsed < RESEND_INTERVAL_MS) await page.waitForTimeout(RESEND_INTERVAL_MS - elapsed + 1000)
  }

  const send = await page.request.post(`${E2E_ORIGIN}/api/auth/email-otp/send-verification-otp`, {
    headers: { ...headers, "x-turnstile-token": TURNSTILE_DUMMY_TOKEN },
    data: { email, type: "sign-in" },
  })
  if (!send.ok()) throw new Error(`コードの送信に失敗しました: ${send.status()} ${await send.text()}`)

  let otp: string | null = null
  await expect
    .poll(
      async () => {
        const after = await readOtp(page, email)
        otp = after.sentAt && after.sentAt !== before.sentAt ? after.otp : null
        return otp
      },
      { timeout: 10_000, message: "新しいコードが届かない" }
    )
    .not.toBeNull()

  const signIn = await page.request.post(`${E2E_ORIGIN}/api/auth/sign-in/email-otp`, {
    headers,
    data: { email, otp },
  })
  if (!signIn.ok()) throw new Error(`コードでのログインに失敗しました: ${signIn.status()} ${await signIn.text()}`)

  // 表示名を入れる（#61 A4）。入れないと、表示名が空のユーザーは画面を開くたびに /onboarding へ誘導される。
  // tRPC の mutation なので、オリジンの確認（#61 A3a の D6）を通るよう Origin を付ける。null なら入れない（表示名の設定の E2E）
  const displayName = options.displayName === undefined ? `E2E ${email.split("@")[0].slice(0, 40)}` : options.displayName
  if (displayName !== null) {
    const res = await page.request.post(`${E2E_ORIGIN}/api/trpc/identity.updateProfile`, {
      headers: { "content-type": "application/json", origin: E2E_ORIGIN },
      data: { json: { name: displayName } },
    })
    if (!res.ok()) throw new Error(`表示名の保存に失敗しました: ${res.status()} ${await res.text()}`)
  }
}

export async function loginAndSaveState(
  page: Page,
  email: string,
  storagePath: string
): Promise<string> {
  await loginWithOtp(page, email)

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
