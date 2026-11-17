# Design: Better Auth に切り替え、メールのコードでログインする

## Context

動機は proposal.md の Why。全体の方針と、検討した案の比較は `docs/features/passkey-email-auth.md`（参照用。2026-11-16 承認）にある。この design は、そこから変わった点と、A3 の実装の決めごとを書く。設計書と食い違うときは、この design を正にする。

今の認証は Auth.js（`next-auth@5.0.0-beta.32`）+ `@auth/drizzle-adapter` + Google、セッションは JWT（`src/infrastructure/auth/index.ts`）。E2E は `E2E_BUILD` のビルドにだけ入る Credentials（`e2e-credentials.ts`）でログインし、条件は `src/lib/e2e/guard.ts`（#70）。tRPC の `createContext` は `auth()` から `userId` などを作る。`AuthContext` は `next-auth/react` の `useSession` を包み、`logout` でログイン中だけの状態を消す。

前提の Issue（#65・#67・#70・#71・#72・#73）はすべて閉じている。#72 のレート制限は Vercel WAF とメモリ上の制限（`src/app/api/ogp/rate-limit.ts`）で、Redis は入っていない。Preview の DB への migrate のジョブ（`migrate-develop`、#134）と、本番の migrate を main へのマージの前に手で流す仕組み（`migrate-production.yml`、#164）はすでにある。

## Goals / Non-Goals

**Goals:**
- Auth.js を Better Auth に置き換え、メールのコードでログインできるようにする（specs の `auth`）
- tRPC の `Context` の形と `useAuth()` の使い方を変えず、ルーターや画面の書き換えを最小にする
- #62 の O9 が `AuthContext` に `status: "offline"` を足せる形にする

**Non-Goals:**
- proposal の Non-goals のとおり（パスキー・表示名・contract・CSP の強制・オフライン）

## Decisions

### D1. ライブラリと版（試作の結果）

（試作の結果をここに書く。better-auth と @better-auth/passkey の版、Next 16.4・zod 4・drizzle-orm 0.45 との相性、emailOTP の `storeOTP: "hashed"` などのオプション名、rateLimit・hooks・cookieCache、クライアントの eval の有無）

### D2. 置き場所と依存の向き

| 置き場所 | 中身 |
|---------|------|
| `src/modules/identity/domain/services/otpAbusePolicy.ts`（新規） | 送信・照合の記録（`otp_events` の行）と今の時刻から、「送ってよい / 黙って送らない / 対話型のチャレンジが要る / ロック中」を決める純粋関数。上限の値もここに定数で置く |
| `src/modules/identity/domain/services/emailAddress.ts`（新規。A1 で作る） | メールアドレスの正規化（NFKC → trim → 小文字 → 形式の確認、ASCII 以外を拒否） |
| `src/modules/identity/infrastructure/OtpEventRepository.ts`（新規） | `otp_events` の読み書き（Drizzle）。アドレスは HMAC-SHA256（鍵は `OTP_EVENT_HMAC_KEY`）にしてから渡す |
| `src/infrastructure/auth/index.ts`（作り直し） | `betterAuth({...})`。フレームワークの設定と、hooks から上の 2 つを呼ぶつなぎ |
| `src/infrastructure/auth/client.ts`（新規） | `createAuthClient` + `emailOTPClient`（A5 で `passkeyClient` を足す） |
| `src/infrastructure/auth/turnstile.ts`（新規） | siteverify の呼び出し（`fetch` を差し替えてテストする） |
| `src/infrastructure/auth/email/**`（A1 で作る） | `EmailSender` と各実装、メールの文面、許可リスト |

domain は Better Auth・Drizzle を import しない。`src/infrastructure/auth` が domain と identity の infrastructure を使う（向きは infrastructure → domain）。

### D3. Better Auth のテーブルの対応（A2 で作る。論点 e）

- `users`: `user.modelName: "users"`。今の列は id（text）・name（NULL 可）・email（unique）・email_verified（timestamp）・image・created_at・updated_at。Better Auth の `emailVerified`（boolean）は A2 で足す `email_verified_flag` に `user.fields` で対応させる。`email_verified`（timestamp）と `image` は Auth.js に戻すときのために A6 まで残す
- `name`: Better Auth は文字列を前提にする。A2 で NULL の行を `''` にし、新しいユーザーも `''` で作る（表示名の入力は A4）。NOT NULL は A6 で付ける
- id は `advanced.database.generateId` で `crypto.randomUUID()`（今の Auth.js と同じ形の text）
- セッション・アカウント・検証は `auth_sessions`・`auth_accounts`・`auth_verifications`。Auth.js の `sessions`・`accounts`・`verification_tokens` と名前がぶつからないようにし、Auth.js のデプロイに戻せるようにする
- rate limit は `rate_limits`、乱用対策の記録は `otp_events`（列とインデックスは設計書の「DB スキーマ」）

### D4. 送信の上限と IP（論点 c）

- IP ごとの上限（3 通/分・20 通/24 時間）は Better Auth の `rateLimit`（`storage: "database"`）の `customRules` で、送信のパスにかける。照合のパス（`/sign-in/email-otp`）は 10 回/分
- 再送の間隔・「アドレス × IP」の上限・累積ロック・チャレンジの段階・通知・監視は、`hooks.before`（送信・照合のパス）で `otpAbusePolicy` を呼んで決める。解除は `hooks.after`（照合の成功）
- 黙って送らないとき（上限・ロック・許可リスト外）は、送ったときと同じ応答を返す（列挙対策）。応答の時間をそろえるため、送るときもメールの送信は応答を待たずに行う（`waitUntil` を使えるか試作で確かめる。使えなければ、送らないときに同じくらいの時間待つ）
- IP は `advanced.ipAddress.ipAddressHeaders` で Vercel が付けるヘッダ（`x-real-ip` など）だけから取る。Vercel がクライアントの値を上書きするかは、実装の前に Vercel のドキュメントで確かめ、design に書き足す。IP が取れないとき（ローカル）は固定のキーにまとめる（制限を外さない）
- Redis は入れない（#72 は Vercel WAF で閉じた）。将来入れたら `secondaryStorage` に切り替える
- 値は承認済みの設計のまま。1 家族の規模には重いが、削らずに 2 つの PR に分ける（D7）

### D5. セッションと `AuthContext`

- DB のセッション（`expiresIn` 30 日、`updateAge` 1 日）に `cookieCache`（5 分）を足す。ログアウトした端末の Cookie はすぐ消える。ほかの端末の失効（A4 の「すべての端末からログアウト」）は最大 5 分遅れる
- tRPC の `createContext` は `auth.api.getSession({ headers })` から今と同じ `userId`・`user` を作る。ルーターは変えない
- `AuthContext` は今の `user`・`isLoading`・`login`・`logout` を保ち、`status: "authenticated" | "unauthenticated" | "loading"` を足す（O9 が `"offline"` を足す）。`login()` はログイン画面（`/login?callbackUrl=<今のパス>`）への移動にする。`logout()` は今と同じくログイン中だけの状態を消してから `signOut`
- 戻り先（`callbackUrl`）は `/` で始まり `//` で始まらないパスだけを受け付け、ほかはホームにする

### D6. 別のオリジンからの mutation（#71 の残り）

`src/app/api/trpc/[trpc]/route.ts` で、POST のうち `Origin` が `BETTER_AUTH_URL`（と `BETTER_AUTH_TRUSTED_ORIGINS`）のオリジンと違うもの、または `Sec-Fetch-Site: cross-site` のものを 403 にする。`Origin` がないリクエスト（同じオリジンの一部のブラウザ・サーバーからの呼び出し）は、`Sec-Fetch-Site` が `cross-site` でなければ通す。GET（query）は変更しないので対象外。

### D7. 実装を 2 つの PR に分ける（A3a・A3b）

| PR | 中身 | specs の Requirement |
|----|------|---------------------|
| A3a | Better Auth への切り替え、コードのログイン、正規化、期限・試行・使い回しの禁止、再送の間隔、列挙対策、Turnstile（非表示）、IP ごとの上限、「アドレス × IP」の上限と累積ロック、許可リスト、紐付け、セッション、ログアウト、オリジンの確認、E2E のルート、next-auth と Credentials の削除、ログイン画面 | 「狙われたアドレスへの対話型のチャレンジ」「制限の通知と解除」「送信数の監視」と、「30 日より古い記録は消える」の Scenario 以外のすべて |
| A3b | 対話型のチャレンジの段階、通知と解除、送信数の監視、30 日の記録の掃除 | 上の残り |

- 1 つの change は 1 つの PR で archive する決まりなので、A3a に着手するとき、A3b の分の Requirement と Scenario を、中身を変えずに新しい change `61-a3b-otp-abuse-escalation` に移す（承認は取り直さない）
- main へは、A3b と A4 が develop に入ってから出す（乱用対策の一部だけで本番に出さない）

### D8. E2E のログイン

- 設計書の「E2E のログイン」のとおり。テスト用のルートは `src/app/api/test/otp/route.e2e.ts` で、条件は今の `isE2ERequestAllowed`（`guard.ts`）をそのまま使う。コードは A1 の `TestMailboxEmailSender` が `globalThis` の Map に持つ
- E2E では制限を外さない。代わりに、ログインのヘルパーはテストごとに別の `x-real-ip` を付け（ローカルは Vercel ではないのでヘッダがそのまま届く）、IP ごとの上限に当たらないようにする。Turnstile は Cloudflare のテスト用のキー
- Playwright の webServer の `AUTH_TRUST_HOST` は、`BETTER_AUTH_URL=http://localhost:<port>` に置き換える
- 既存の `e2e/auth/**` は新しいヘルパー（送信 → テスト用のルートからコード → `sign-in/email-otp` → storageState）で全件通す

### D9. CSP

`src/lib/security/headers.ts` の Report-Only の `script-src` と `frame-src` に `https://challenges.cloudflare.com` を足す（Turnstile）。強制の CSP（今あるもの）にも Turnstile を妨げる指定がないかを確かめる。CSP 全体の強制は別の Issue（proposal の確認事項 4）。

## リリースの手順（設計書からの変更。論点 a・b）

- リリースの名前を #62 とぶつからないよう AR0〜AR3 にする（リーダーの判断、2026-11-18）
- 順番: #62 の R2a・R2b → **AR1a**（A1 + A2）→ **AR1b**（A3a + A3b + A4）→ #62 の R3（O6〜O9）→ **AR2**（A5、本番ドメインの切り替えの後）→ **AR3**（A6、AR1b から 2 週間後）
- AR0（前提のセキュリティ修正）は終わっている。告知バナー（A0）はやめた
- AR1a の expand は、本番への migrate を main へのマージの前に手で流す（`.claude/rules/team-operation.md` の「DB の変更を含むリリース」）。Preview の DB は `migrate-develop` が流すので、設計書にある「A2 で CI のジョブを足す」は要らない
- AR3 の contract は別のリリースにし、main への push の migrate で流す
- 戻し方: AR1b の後に戻すときは、Vercel で AR1a のデプロイを Promote する（設計書の「ロールバック」のとおり。AR1a は #62 の R2 を含むので、R2 の分は戻らない）

## Risks / Trade-offs

- [Better Auth の版が上がって API が変わる] → 版を固定し、Dependabot の更新は E2E を流してから入れる
- [Vercel の IP のヘッダを取り違えると、上限が効かないか全員が同じキーになる] → 実装の前に確かめ、偽装したヘッダで上限のキーが変わらないことをテストする
- [Resend の無料枠（100 通/日）を使い切られる] → IP・「アドレス × IP」の上限と Turnstile、70 通での知らせ。パスキー（AR2）を早めに家族に登録してもらう
- [切り替えで家族がログインできない] → 30 分以内に直せなければ AR1a のデプロイに Promote で戻す
- [乱用対策の実装が多い] → A3a・A3b に分ける（D7）

## Open Questions

- 試作の結果しだいで、D1 と D4（`waitUntil`）を書き足す
