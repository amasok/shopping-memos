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

### D1. ライブラリと版（試作の結果。2026-11-18）

試作は使い捨ての worktree で行い、コードは残していない。

- **版**: `better-auth@1.7.25`・`@better-auth/passkey@1.7.25`（どちらも latest）。next ^16・react ^19・drizzle-orm ^0.45.2 と合う。zod は ^4.5.4 に依存し、今の 4.6.7 に 1 つにまとまる（二重に入らない）。版は `^` を付けずに固定する
- **入れるときのぶつかり（要対応）**: 普通の `npm install` は ERESOLVE で失敗する。(a) better-auth の任意の peer（@sveltejs/kit 3 など）が vite 8 を求め、今の vite 7.3.1（vitest 4.0.18・@vitejs/plugin-react 5.1.2）とぶつかる。(b) next-auth・@auth/core の peer が @simplewebauthn ^9 で、passkey の 13.3.x と合わない。`--legacy-peer-deps` なら入り、tsc と build も通るが、自動で入っていた peer が lock から 79 個消え、CI の `npm ci` も `--legacy-peer-deps` が要るようになる
  - 方針: `legacy-peer-deps` は使わない。(b) は、`@better-auth/passkey` を A5 で入れることで A3 では起きない（A3 の間は better-auth と next-auth を並べて入れ、置き換えが終わってから next-auth を消す。A5 の時点では next-auth はもうない）。(a) は、A3 の前に別の PR で vitest 4.1・@vitejs/plugin-react 5.2・vite 8 に上げる（今の lock のまま上げると npm 10 のエラー `Cannot read properties of null (reading 'edgesOut')` で止まるので、lock の作り直しも含む）。それでも残るときは、package.json の `overrides` で個別に合わせる
- **emailOTP**: `otpLength` 6・`expiresIn` 300・`allowedAttempts` 3 は既定のまま。`storeOTP` の既定は平文なので必ず指定する。`"hashed"` は塩なしの SHA-256 で、DB が漏れると 6 桁のコードはすぐ割り出せるので、`storeOTP: { hash }` で HMAC-SHA256 にする。鍵は `BETTER_AUTH_SECRET` をそのまま使わず、用途のラベル（例: `otp-hash`）を付けて HKDF で導出する。照合は定数時間（`constantTimeEqual`）で、原子的な consume の中で行う。再送すると新しい行ができ、照合には最新の行だけを使う（古いコードは 400）。成功すると行は消える。3 回まちがえると 403 `TOO_MANY_ATTEMPTS`。**再送すると回数は 0 に戻る**ので、累積ロックは `otp_events` で自前に持つ（D4）。`disableSignUp` は既定 false で、未登録のアドレスはサインインのときに作られる（name `""`・emailVerified true）
- **rateLimit**: `storage: "database"`・`customRules`（ワイルドカード・関数も可。プラグインの既定（OTP のパスは 60 秒に 3 回）より優先）・`rateLimit.modelName`・`advanced.ipAddress.ipAddressHeaders`。キーは `IP|パス`。`x-forwarded-for` を変えても `x-real-ip` のキーのままで、4 回目が 429 になることを確かめた。`rate_limits.key` には unique が要る
- **hooks**: `hooks.before` で `ctx.path` を見て `APIError` を投げると、その応答（429 など）を返せる。`hooks.after` では `ctx.context.newSession` でサインインの成功がわかる
- **セッション**: `session.cookieCache`・`freshAge`・`/revoke-sessions`（クライアントは `revokeSessions()`）がある。cookieCache を有効にすると、`getSession` が Cookie を先に読むので、失効の後も最大 maxAge の間ログインしたままに見える（D5 で使わないことにした）
- **CSP**: 認証のクライアントのチャンク（49KB。passkey と simplewebauthn/browser を含む）に `eval`・`new Function` はない。better-auth のクライアントは zod を読み込まない。サーバー側の zod の import は CSP に関係しない
- **スキーマの生成**: `@better-auth/cli` は deprecated。`npx auth@1.7.25 generate --config <file> --output <file> -y` を使い、出力は schema.ts に手で写す（A2）
- **build**: `BETTER_AUTH_SECRET` がないと build のログに BetterAuthError（既定の secret）が出る（終了コードは 0）。CI の build にはダミーの値を渡す
- **A5（パスキー）への申し送り**: `rpID`・`origin`・`authenticatorSelection` は渡せ、SimpleWebAuthn は server 13.3.3・browser 13.3.0。登録の 2 つの API は fresh session を求めるが、**`/passkey/delete-passkey` は求めない**ので、`hooks.before` で `getSessionFromCtx` のセッションの `createdAt` を自前で確かめる。`freshAge` は全体の設定で、600 にするとほかのアカウント系の API も 10 分以内のログインを求めるようになるので、A5 の design で決める
- 確かめていないこと: `waitUntil`（Next.js の `after()` を使う）
- **入れた結果（0.2。2026-11-18）**: vite 8 の後の develop で、`npm install --save-exact better-auth@1.7.25` が `--legacy-peer-deps` なしで通った（17 パッケージを追加）。`npm audit` の件数は入れる前と同じ（増えていない）。next-auth と並べて入れている
- **`disabledPaths`**: 全体の設定の `disabledPaths?: string[]`。一致したパスは Better Auth が 404 を返す
- **IPv6**: `advanced.ipAddress.ipv6Subnet`（既定 64）で、rate limit のキーを /64 にまとめる。`@better-auth/core` の `normalizeIP(ip, { ipv6Subnet })` で同じ丸め方を自前のキー（1.2）にも使える。`trustedProxies` を設定しないときは、カンマ区切りでない 1 つの値のヘッダだけを信頼する（複数の値なら IP なし）
- **環境変数の確認（0.3）**: `src/infrastructure/auth/env.ts` の `resolveAuthEnv`。本番・Vercel・`NODE_ENV=production` では `BETTER_AUTH_SECRET`（32 文字以上）・`BETTER_AUTH_URL`（オリジン）・`OTP_EVENT_HMAC_KEY`（32 文字以上、secret と別の値）・`TURNSTILE_SECRET_KEY`・`NEXT_PUBLIC_TURNSTILE_SITE_KEY` が必須。本番（`VERCEL_ENV=production`）では Turnstile のテスト用のキーを拒否する。ローカルの開発では開発用の値とテスト用のキーで埋める。サーバーの起動時（`src/instrumentation.ts` の `register`）に、A1 のメールの設定とあわせて確かめる。`next build` では呼ばれないので、CI の build に要るダミーは `NEXT_PUBLIC_TURNSTILE_SITE_KEY` だけ。E2E（ci.yml・sw-e2e.yml・e2e-local.sh）には E2E 専用の値を渡し、`BETTER_AUTH_URL` は playwright.config.ts が webServer ごとに渡す。Better Auth の本体は、モジュールの読み込みではなく最初に使うときに作る（2.1。A1 の申し送り）

### D2. 置き場所と依存の向き

| 置き場所 | 中身 |
|---------|------|
| `src/modules/identity/domain/services/otpAbusePolicy.ts`（新規） | 送信・照合の記録（`otp_events` の行）と今の時刻から、「送ってよい / 黙って送らない / 対話型のチャレンジが要る / ロック中」を決める純粋関数。上限の値もここに定数で置く |
| `src/shared/schemas/email.ts`（新規。A1 で作る） | メールアドレスの正規化（NFKC → trim → 小文字 → 形式の確認、ASCII 以外を拒否、254 文字まで）。ログイン画面とサーバーで共用する |
| `src/modules/identity/infrastructure/OtpEventRepository.ts`（新規） | `otp_events` の読み書き（Drizzle）。アドレスは HMAC-SHA256（鍵は `OTP_EVENT_HMAC_KEY`）にしてから渡す |
| `src/infrastructure/auth/index.ts`（作り直し） | `betterAuth({...})`。フレームワークの設定と、hooks から上の 2 つを呼ぶつなぎ |
| `src/infrastructure/auth/client.ts`（新規） | `createAuthClient` + `emailOTPClient`（A5 で `passkeyClient` を足す） |
| `src/infrastructure/auth/turnstile.ts`（新規） | siteverify の呼び出し（`fetch` を差し替えてテストする） |
| `src/infrastructure/auth/email/**`（A1 で作る） | `EmailSender`（`sendOtp`・`sendNotice`）と各実装、メールの文面、許可リスト、環境変数の確認。Resend は SDK を使わず `fetch` で呼ぶ。送信に失敗すると例外を投げ、A3 の側で受け止めてログに出す（応答は送れたときと同じ） |

domain は Better Auth・Drizzle を import しない。`src/infrastructure/auth` が domain と identity の infrastructure を使う（向きは infrastructure → domain）。

### D3. Better Auth のテーブルの対応（A2 で作る。論点 e）

- `users`: `user.modelName: "users"`。今の列は id（text）・name（NULL 可）・email（unique）・email_verified（timestamp）・image・created_at・updated_at。Better Auth の `emailVerified`（boolean）は A2 で足す `email_verified_flag` に `user.fields` で対応させる。`email_verified`（timestamp）と `image` は Auth.js に戻すときのために A6 まで残す
- `name`: Better Auth は文字列を前提にする。A2 で NULL の行を `''` にし、新しいユーザーも `''` で作る（表示名の入力は A4）。NOT NULL は A6 で付ける
- id は `advanced.database.generateId` で `crypto.randomUUID()`（今の Auth.js と同じ形の text）
- セッション・アカウント・検証は `auth_sessions`・`auth_accounts`・`auth_verifications`。Auth.js の `sessions`・`accounts`・`verification_tokens` と名前がぶつからないようにし、Auth.js のデプロイに戻せるようにする
- rate limit は `rate_limits`（`rateLimit.modelName: "rateLimits"`）、乱用対策の記録は `otp_events`。`otp_events` は設計書の「DB スキーマ」から次を変える: `ip` は NOT NULL（取れないときは `'unknown'`）、`kind` は `sent`・`attempted`（照合に進む前に記録する。D4）・`locked`・`unlocked`・`notified`（本人への通知）・`alerted`（管理者への知らせ）、`email_hash` は `alerted` のときだけ NULL を許す、インデックスに `(kind, created_at)` を足す（全体の送信数と 30 日の掃除）

### D4. 送信と照合の上限（論点 c）

- **IP ごとの上限**（送信 3 通/分・20 通/24 時間、照合 10 回/分）は、Better Auth の `rateLimit`（`storage: "database"`、`customRules`）でかける。IP は `advanced.ipAddress.ipAddressHeaders` で、Vercel が付けるヘッダ（`x-real-ip` など）だけから取る。IPv6 は /64 にまとめる（Better Auth に設定があれば使い、なければ自前で丸める）。Vercel がクライアントの値を上書きするかは、実装の前に Vercel のドキュメントで確かめ、ここに書き足す。IP が取れないとき（ローカル）は固定のキー `'unknown'` にまとめる（制限を外さない）。Better Auth の rate limit は同時のリクエストで数件はみ出すことがありうるが、IP の上限は枠の目安なので受け入れる
- **使う IP のヘッダ（0.1 で確かめた。2026-11-18、リーダーの判断で案 A）**: `x-real-ip` だけを使う（`ipAddressHeaders: ["x-real-ip"]`）。`x-forwarded-for`・`x-vercel-forwarded-for` は使わない
  - 根拠（vercel.com/docs/headers/request-headers）: `x-forwarded-for` は "we currently overwrite the X-Forwarded-For header and do not forward external IPs. This restriction is in place to prevent IP spoofing."。`x-real-ip` は "This header is identical to the x-forwarded-for header."。Vercel 公式の `@vercel/functions` の `ipAddress()` も `x-real-ip` だけを読む（ソースのコメントは "Client IP as calculated by Vercel Proxy."）
  - `x-real-ip` を上書きすると明記した公式の記述はない（間接の根拠）。そのため、本番の前に Preview で、偽の `x-real-ip`・`x-forwarded-for` を付けた送信で `otp_events.ip` などに記録される IP がクライアントの値にならないことを確かめる（6.3 の確認項目。一時的なルートは作らない）。Vercel のサポートへの問い合わせはしない
  - 偽装した `x-forwarded-for` でキーが変わらないことは、ユニットテストで確かめる（1.2・2.3）
- **アドレスに結びつく上限**（再送の間隔・「アドレス × IP」の 5 通・累積ロック・1 つのコードの 3 回・チャレンジの段階）は、`hooks.before`（送信・照合のパス）で `otpAbusePolicy` を呼んで決める。解除は `hooks.after`（照合の成功）
- **同時のリクエストでも数えもれがないようにする（レビュー H1）**: 送信・照合の判定は、1 つのトランザクションの中で `pg_advisory_xact_lock`（キーはアドレスの HMAC）を取ってから「記録を INSERT → 数える → 判定」の順に行う。同じアドレスへのリクエストは直列になり、判定は自分の分を含めた数で行う。照合は、照合に進む前に `attempted` を記録する（成功しても記録は残し、成功の後に `unlocked` を記録して、それより前の分を数えない）。数え方:
  - `sent` は実際にメールを送ったとき（新しいコードができたとき）だけ記録する。黙って見送った送信では記録しない（記録すると、コードが変わらないまま回数が 0 に戻るため）
  - 1 つのコードの照合: そのアドレスの最後の `sent` の後の `attempted` が 3 件を超えたら、Better Auth の照合に進まず期限切れと同じ応答にする（Better Auth の `allowedAttempts: 3` も重ねてかける）
  - 累積ロック: 同じ「アドレス × IP」の、直近 24 時間かつ最後の `unlocked` より後の `attempted` が 10 件に達したら `locked` を記録する。`locked` から 24 時間は、その「アドレス × IP」の照合を断る
  - チャレンジ: アドレスの直近 24 時間の `sent` が 20 件、または最後の `unlocked` より後の `attempted` が 30 件に達したら、チャレンジの段階にする
  - 照合の失敗の数として `attempted` を使う（成功の後は `unlocked` で区切るので、失敗の数と同じになる）。A2 の `otp_events.kind` は `sent`・`attempted`・`locked`・`unlocked`・`notified`・`alerted`
- **判定と記録の順（1.1・1.3 で決めた）**: advisory lock の中で「読む → `otpAbusePolicy` で判定 → 進むときだけ記録する」。照合として扱わなかったもの（断ったもの）は `attempted` に数えない（数えると、同時の 10 件で累積ロックまで進んでしまう）。10 回目の照合は照合に進み、その記録と同時に `locked` を記録する（「10 回目から 24 時間止める」、同時の 3 件では 1 件だけ照合される）。`unlocked` は、A3a でもログインの成功のたびに記録し、累積ロックの数え直しに使う（記録しないと、同じ IP から 1 日に 10 回ログインした本人がロックされる）。`locked` を `unlocked` で解く（A3b）のは A3a ではしない。記録の時刻はアプリの時刻（ロックの中の判定と同じ値）
  - 読むのは判定に要る行だけ（レビューの M）: この「アドレス × IP」の直近 24 時間の行、アドレスの最新の `sent` と `unlocked`、最新の `sent` の後の `attempted`。アドレス全体の行を件数の上限つきで読むと、別の IP から行を積まれたときに、この IP の `locked` が落ちてロックが解けるため
  - 30 日の掃除は、送信のついでに**プロセス（Vercel ではインスタンス）ごとに** 1 日 1 回。インスタンスが増えると DELETE も増えるが、件数は少ないので受け入れる
  - ローカル（開発・テスト）で IP のヘッダがないとき、`otp_events.ip` は `'unknown'`、Better Auth の rate limit のキーは 127.0.0.1（Better Auth の開発時の既定）で、値がそろわない。本番は `x-real-ip` が必ずあるので害はない
  - **コードがないときは照合に進まない（テストの不安定から見つけた）**: Better Auth は、期限切れの検証の行を、ほかのリクエストのついでに全体から消す（インスタンスごとに一定の間隔）。そのままだと、期限切れのコードを入れた人に、行が先に消されていれば「不一致」が出る。照合の hooks で、そのアドレスに期限内のコードの行がなければ、`attempted` を記録せずに `OTP_EXPIRED`（「コードの有効期限が切れました。再送信してください」）を返す。使ったコード・送っていないアドレスでも同じ応答になる
- **IP のキー（1.2）**: `src/infrastructure/auth/ip.ts` の `clientIpKey`。`@better-auth/core/utils/ip` の `getIPFromHeader`（better-auth と同じ 1.7.25 に固定して直接の依存にした）で、Better Auth の rate limit と同じく /64 に丸める。取れないときは `'unknown'`（Better Auth の rate limit は `no-trusted-ip` の 1 つのキーにまとめる。どちらも制限は外さない）
- **黙って送らないとき**（再送の間隔・「アドレス × IP」の上限・ロック・許可リスト外）は、Better Auth の送信の処理に進まずに、送ったときと同じ応答を返す。新しいコードを作らないので、今のコードは無効にならない（レビュー M6）。応答の時間をそろえるため、送るときもメールの送信は応答を待たずに行う（Next.js の `after()` で送る）
- **使わない API を閉じる（レビュー H2）**: `src/app/api/auth/[...all]/route.ts` で、許可リストにあるパス（`/email-otp/send-verification-otp`・`/sign-in/email-otp`・`/get-session`・`/sign-out`）以外は Better Auth に渡さずに 404 を返す。送信は `type` が `sign-in` 以外なら 400 にする。Better Auth の `disabledPaths` も重ねてかける（試作で名前を確かめる）。A4・A5 は、それぞれの change で許可リストに足す
- **Turnstile（レビュー H4）**: secret はウィジェットごとに別にする（`TURNSTILE_SECRET_KEY` は非表示、`TURNSTILE_CHALLENGE_SECRET_KEY` は対話型）。チャレンジの段階では対話型の secret でだけ siteverify する。どちらも結果の `hostname` がアプリのホスト（Preview は Preview のホスト）、`action` が `send-otp` であることを確かめる。テスト用のキーは常に成功するので、チャレンジの段階の Scenario はユニットテスト（siteverify の `fetch` を差し替える）で確かめる
- **通知**（A3b）: 制限の通知は、登録済みのアドレスにだけ、直近 24 時間に `notified` がなければ送る。管理者への知らせは、直近 24 時間の `sent` が 70 件を超え、直近 24 時間に `alerted` がなければ送る。「1 日」はどれも直近 24 時間（暦日ではない）
- **解除**: ログインに成功したら `unlocked` を記録する。ロック・チャレンジの段階（失敗の数による分）・失敗の数はそれで区切られる。送信の数（5 通・20 通）は区切らない
- **コードの入力にチャレンジをかけない（設計書からの意図した変更。レビュー L6）**: 設計書は失敗 30 回で「送信とコードの入力」の両方にチャレンジをかけるとしていた。1 つのコードの照合は 3 回までで、新しいコードは送信のチャレンジを通らないと届かないので、送信だけで足りる
- Redis は入れない（#72 は Vercel WAF で閉じた）。将来入れたら `secondaryStorage` に切り替える
- 値は承認済みの設計のまま。1 家族の規模には重いが、削らずに 2 つの PR に分ける（D7）

- **本体の実装（2.x で決めた）**
  - Better Auth は `src/infrastructure/auth/server.ts` の `createAuth(deps)`（DB・メール・`otp_events`・Turnstile・時計を渡す）と `getAuth()`（最初に呼んだときに作る）。Auth.js の `index.ts` は 5.5 まで残し、5.5 で `index.ts` を Better Auth の入口にする
  - **IP ごとの 24 時間 20 通は `otp_events` で数える**: Better Auth の rateLimit は 1 つのパスに 1 つの窓しか持てないので、1 分 3 通（送信）・1 分 10 回（照合）だけを `customRules` でかけ、24 時間 20 通は送信の hooks で、その IP の直近 24 時間の `sent` を数えて 429 にする。IP のロックは取らないので同時の送信で 1〜2 通はみ出しうるが、1 分 3 通の rateLimit が先にかかるので受け入れる（D4 の「IP の上限は枠の目安」）
  - hooks.before で本文を書き換えるときは、本文そのものを許したキーだけにする（`{ context: { body } }` を返すと Better Auth が元の本文と混ぜ、`name`・`image` が残るため）。送信は `{ email, type: "sign-in" }`、照合は `{ email, otp }` だけにする（新しいユーザーの `name` は `''`、`image` は入れない）
  - 送信の hooks の順: 種類（`sign-in` だけ）→ 正規化 → Turnstile → IP の 24 時間 → 許可リスト → `guardSend`。許可リストの外も `guardSend` の見送りも `{ success: true }`（送ったときと同じ）を返し、Better Auth の送信に進まない（新しいコードを作らない）
  - エラーのコード（4.3 で文言に対応させる）: `INVALID_OTP`（不一致）・`OTP_EXPIRED`（期限切れ）・`TOO_MANY_ATTEMPTS`（1 つのコードの 3 回。期限切れと同じ文言）・`OTP_LOCKED`（累積ロック）・`TURNSTILE_FAILED`（403）・`RATE_LIMITED`（IP の 24 時間。429）・Better Auth の rateLimit の 429・`INVALID_EMAIL`・`INVALID_OTP_TYPE`
  - メールは `advanced.backgroundTasks.handler` に Next.js の `after()` を渡して応答と切り離す。送信の失敗は Better Auth がログに出す（応答は送れたときと同じ）
  - Turnstile（2.4）: Cloudflare のテスト用の secret（`1x…` は常に成功、`2x…`・`3x…` は常に失敗）は、ネットワークに出ずにその決まりどおりに返す（テスト用のキーは本物の hostname・action を返さないため。本番ではテスト用のキーを使えない）。トークンはヘッダ `x-turnstile-token` で受け取る
  - `nextCookies()` は Next.js のリクエストの外では何もしないので、テストでも常に入れる

### D5. セッションと `AuthContext`

- DB のセッション（`expiresIn` 30 日、`updateAge` 1 日）。**`cookieCache` は使わない**（設計書からの変更。レビュー M4）。cookieCache があると、ログアウトやセッションの削除の後も、控えておいた Cookie が最大 5 分通る。家族の規模なら、リクエストごとのセッションの読み込み（主キーで 1 行）は軽いので、すぐ効くほうを取る。A4 の「すべての端末からログアウト」もすぐ効く
- Cookie は Better Auth の既定（`HttpOnly`・`SameSite=Lax`、https では `Secure`）。`advanced.useSecureCookies` は本番で true になることを確かめる
- tRPC の `createContext` は `auth.api.getSession({ headers })` から今と同じ `userId`・`user` を作る。ルーターは変えない
- `AuthContext` は今の `user`・`isLoading`・`login`・`logout` を保ち、`status: "authenticated" | "unauthenticated" | "loading"` を足す（O9 が `"offline"` を足す）。`login()` はログイン画面（`/login?callbackUrl=<今のパス>`）への移動にする。`logout()` は今と同じくログイン中だけの状態を消してから `signOut`
- 戻り先（`callbackUrl`）は、`new URL(value, location.origin)` の `origin` がアプリのオリジンと同じときだけ、その `pathname + search + hash` を使い、ほかはホームにする（`/\evil.example` やタブ・改行を含む値を通さない。レビュー M1）

- **実装（4.x で決めた）**: `login()` と、ログインの成功の後の移動、ログアウトの後のホームへの移動は、`window.location.assign` で読み込み直す（React Query のキャッシュなど、前のユーザーの状態を残さない。ゲストのデータの取り込みは読み込みの後に `DataMergeContext` が行う）。戻り先の検証は `src/lib/auth/callbackUrl.ts`（`/login` には戻さない）。ログイン画面は `src/components/auth/LoginForm.tsx`、文言は `otpMessages.ts`（エラーのコードから決める）、Turnstile は `useTurnstile.ts`（`execution: "execute"` の非表示のウィジェット。送信のたびに reset してトークンを取り直す。E2E のビルドでテスト用のサイトキーのときだけ、スクリプトを読まずに Cloudflare のダミーのトークンを使う）

- **セッションがわからないときは、ゲストとして出すが、ログイン中だけの状態は消さない（E2E の回帰から見つけた。2026-11-18。レビューの High で loading 案から変えた）**: Better Auth のクライアントは、セッションの取得が通信のエラー（ページを離れるときに切れた通信・オフライン）やサーバーのエラーになると、`data: null`・`isPending: false` にする。これをそのまま「ログインしていない」として扱うと、GroupContext と DataMergeContext が、ログイン中だけの状態（選んでいたグループ・merge 済みの印）を消してしまう。loading にすると、ゲストの一覧（`isAuthLoading` を待つ）がオフラインで止まる。そこで:
  - `status` はエラーなら `unauthenticated`（画面はゲストの DB で出す。オフラインでも止まらない）
  - `AuthContext` に `sessionKnown` を足す。正常な応答か 401 のときだけ true（通信のエラー・5xx・読み込み中は false）
  - GroupContext は、ゲストとして出している間はグループで絞り込まない（`selectedGroupId` を undefined として出す）が、保存した値を消すのは `sessionKnown` のときだけ。DataMergeContext の `clearLoginScopedState` も `sessionKnown` のときだけ
  - ログイン中の取り直しのエラーでは、Better Auth が前のセッションを残すので `authenticated` のまま。#62 の O9 で `offline` を足すときは、`sessionKnown` が false の場合を `offline` に分けられる
  - **オフラインで作ったものの merge（リーダーの指示で A3a で直す。2026-11-18）**: ログイン中のユーザーがオフラインで最初に開くと、ゲストとして表示される。その間に作ったものはゲストの DB に入る。merge 済みの印が残ったままだと、オンラインに戻っても merge されずに見えなくなる（Auth.js のころは印が消え、次のログインで merge されていた。今の動きからの後退）。そこで、セッションがわからずゲストとして出している間（`!user && !isLoading && !sessionKnown`）は、DataMergeContext がゲストの DB（商品・タグ・リスト・リストの中身）への書き込みを Dexie の hook で見張り（`watchGuestWrites`）、書き込みがあれば merge 済みの印だけを消す（`clearMergeCompletedMarks`。選んでいたグループは残す）。次にセッションが確かになると、いつものログインと同じく merge で送る。E2E（`e2e/auth/session-unknown-merge.spec.ts`）は、get-session を失敗させて再現する（Playwright のオフラインは Service Worker の通信に効かず、SW 経由の get-session が成功してしまうため、SW を止めて `page.route` で失敗させる）。オフラインのログイン中の書き込みの行き先そのもの（ゲストの DB を経由しない形）は、O9 で `offline` を足すときに決める
- **セッションの取得は rate limit をかけない**: `customRules` で `/get-session` を外した。画面はフォーカスのたびなどに呼び、IP が取れないとき（共有のキー）に Better Auth の既定（10 秒に 100 回）を使い切ると 429 になるため。Cookie を読むだけで、トークンは推測できない長さ

### D6. 別のオリジンからの POST（#71 の残り。レビュー H3）

- tRPC の route（`src/app/api/trpc/[trpc]/route.ts`）と認証の route（`src/app/api/auth/[...all]/route.ts`）の POST に、同じ確認（`src/lib/security/origin.ts` に置く）をかける: `Origin` があって、`BETTER_AUTH_URL`（と `BETTER_AUTH_TRUSTED_ORIGINS`）のオリジンと違えば 403（`null` も 403）。`Sec-Fetch-Site: cross-site` なら 403。`Origin` も `Sec-Fetch-Site` もないリクエストは通す（ブラウザ以外。Cookie を持たないので CSRF にならない）
- 認証の route では Cookie の有無にかかわらずかける。攻撃者が自分のアドレスで被害者のブラウザをログインさせ、`DataMergeContext` で被害者のゲストのデータを取り込む（ログインの CSRF）のを防ぐ。Better Auth の Origin の確認（`trustedOrigins`）も有効のままにする
- GET（tRPC の query・セッションの取得）は変更しないので対象外

- **実装（3.x で決めた）**: 認証の route の許可リスト・オリジン・送信の種類の確認は `src/infrastructure/auth/route.ts` の `createAuthRouteHandler`（`[...all]/route.ts` はそれに `getAuth` をつなぐだけ）。許可リストはメソッドとパスの組（`GET /get-session`、`POST` の送信・照合・`/sign-out`）で、末尾の `/` や `%2F` を含むパスも 404。GET はオリジンを確かめない。tRPC の `createContext` は `({ req })` を受け取り、`getAuth().api.getSession({ headers: req.headers })` から作る（リクエストがなければ空）

### D7. 実装を 2 つの PR に分ける（A3a・A3b）

| PR・change | 中身 |
|-----------|------|
| A3a（この change） | Better Auth への切り替え、コードのログイン、使わない API を閉じる、正規化、期限・試行・使い回しの禁止、再送の間隔、黙って送らないとき、列挙対策、Turnstile（非表示）、IP ごとの上限、「アドレス × IP」の上限と累積ロック（`otp_events` の記録と 30 日の掃除を含む）、許可リスト、紐付け、セッション、ログアウト、オリジンの確認、E2E のルート、next-auth と Credentials の削除、ログイン画面 |
| A3b（`61-a3b-otp-abuse-escalation`） | 狙われたアドレスへの対話型のチャレンジ、制限の通知と解除、送信数の監視 |

- 1 つの change は 1 つの PR で archive する決まりなので、承認の後（2026-11-18）に A3b の分の Requirement と Scenario を、中身を変えずに `61-a3b-otp-abuse-escalation` に移した（承認は取り直さない）。30 日の記録の掃除は、`otp_events` を作る A3a に入れた
- A3a の時点では、ロックは 24 時間で解けるだけ（ログインの成功での解除は A3b）
- main へは、A3b と A4 が develop に入ってから出す（乱用対策の一部だけで本番に出さない）

### D8. E2E のログイン

- 設計書の「E2E のログイン」のとおり。テスト用のルートは `src/app/api/test/otp/route.e2e.ts` で、条件は今の `isE2ERequestAllowed`（`guard.ts`）をそのまま使う。コードは A1 の `TestMailboxEmailSender` が `globalThis` の Map に持つ。`TestMailboxEmailSender` を選ぶ条件は、テスト用のルートと同じく、ビルド時の `E2E_BUILD` が `"true"` かつ `isE2ERuntimeEnabled`（A1 の担当に依頼済み）
- E2E では制限を外さない。代わりに、ログインのヘルパーはテストごとに別の `x-real-ip` を付け（ローカルは Vercel ではないのでヘッダがそのまま届く）、IP ごとの上限に当たらないようにする。Turnstile は Cloudflare のテスト用のキー
- Playwright の webServer の `AUTH_TRUST_HOST` は、`BETTER_AUTH_URL=http://localhost:<port>` に置き換える
- 既存の `e2e/auth/**` は新しいヘルパー（送信 → テスト用のルートからコード → `sign-in/email-otp` → storageState）で全件通す

- **実装（5.x で決めた）**: テスト用のルートは `{ otp, sentAt, now }` を返す。ログインのヘルパー（`loginWithOtp`）は、同じアドレスに 60 秒以内に送るとサーバーが黙って見送る（再送の間隔）ので、前の送信からの残りの時間だけ待ってから送り、前より新しいコードが届くのを待つ。同じアドレスに 2 回ログインする spec（guest-merge-lifecycle・guest-merge-pending）は、制限時間を延ばした。画面からのログインの E2E（`login.spec.ts`）は、`page.setExtraHTTPHeaders` でテストごとに別の `x-real-ip` を付ける。Auth.js の環境変数（`AUTH_SECRET`・`AUTH_TRUST_HOST`）は CI・E2E から消した（`.env.example` の Auth.js・Google の値は A6 で消す）

### D9. CSP

`src/lib/security/headers.ts` の Report-Only の `script-src` と `frame-src` に `https://challenges.cloudflare.com` を足す（Turnstile）。強制の CSP（今あるもの）にも Turnstile を妨げる指定がないかを確かめる。CSP 全体の強制は別の Issue（proposal の確認事項 4）。

- **CSP の確認（6.2。2026-11-18）**: `E2E_BUILD` なしの本番ビルドを、Turnstile のテスト用のキーで `next start` し、headless の Chromium でログイン画面を開いてコードを送った。Turnstile のスクリプト（`challenges.cloudflare.com/turnstile/v0/api.js`）が読み込まれ、トークンを取って送信まで進み、コンソールに CSP（Report-Only）の違反・エラーは出なかった。本物のサイトキーでの確認は、AR1b の Preview の確認項目に入れた

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
- [Preview は Turnstile のテスト用のキーで常に通る] → Preview は許可リスト（`EMAIL_RECIPIENT_ALLOWLIST`）にあるアドレスにしか送らず、Deployment Protection もかけるので受け入れる
- [Cloudflare のプロキシを ON にすると、IP がすべて Cloudflare のものになり、IP の上限が全員で 1 つになる] → `shopping.counoco.net` の CNAME は DNS only（プロキシ OFF）を保つ。docs/INFRASTRUCTURE.md にも書く（A6）
- [通知のメールで第三者に迷惑をかける] → 通知は登録済みのアドレスにだけ、24 時間に 1 通まで

## Open Questions

- （解決）Vercel の IP のヘッダ: `x-real-ip` だけを使う。公式の明記はないので、Preview で確かめる（D4・6.3）
- vite 8 への更新は shopping-memos-vite8 が受け持つ（リーダーの判断、2026-11-18）。dev 依存の更新の PR（chore/dev-deps-audit。vite 7.3.8・vitest 4.1.12）と #193 の後に行い、A3 はその後に始める
