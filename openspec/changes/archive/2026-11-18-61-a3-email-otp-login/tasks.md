# Tasks

ユーザーの承認（2026-11-18）は済んでいる。始める前に、A1（`61-a1-email-sender`）・A2（`61-a2-auth-tables-expand`）・vite 8 への更新が develop に入っていること。各タスクは RED → GREEN → REFACTOR の順に進める。かっこ内は、そのタスクでテストを書く specs の Scenario。実 DB が要るテストは `*.db.test.ts` に置く（`npm run test:db`）。

進め方（PR が大きいため。レビュー M2）:
- 節（0〜6）ごとにコミットを分け、どのコミットも 1000 行を超えないようにする
- どの節の終わりでも `npm run test:run` と `npm run build` が通る状態にする（next-auth は 5 の後まで残す。0.2）
- 節の区切りごとに HEAD を tester と reviewer に渡し、少しずつ見てもらう。3.3（tRPC の `createContext` の置き換え）から 4.1（`AuthContext` の置き換え）までは画面からのログインが動かないので、E2E は 5 の後に流す

## 0. 準備

- [x] 0.1 Vercel が `x-real-ip`・`x-vercel-forwarded-for` をクライアントの値で上書きさせないかを Vercel のドキュメントで確かめ、使うヘッダを design の D4 に書き足す（使えるヘッダがなければ、ここで止めてリーダーに知らせる）
- [x] 0.2 `better-auth@1.7.25` を版を固定して入れる。`next-auth`・`@auth/drizzle-adapter` は置き換えが終わる 5.5 まで残す（並べて入れる）。`@better-auth/passkey` は A5 で入れる（入れると next-auth の @simplewebauthn ^9 とぶつかるため。D1）。`--legacy-peer-deps` は使わない。ぶつかりが残るときは `overrides` で合わせる。`disabledPaths` の名前と、IPv6 を /64 にまとめる設定の有無を確かめ、design の D1 に書き足す
- [x] 0.3 環境変数の確認（Zod）に `BETTER_AUTH_SECRET`・`BETTER_AUTH_URL`・`BETTER_AUTH_TRUSTED_ORIGINS`・`OTP_EVENT_HMAC_KEY`・`TURNSTILE_SECRET_KEY`・`NEXT_PUBLIC_TURNSTILE_SITE_KEY` を足す（本番で欠けたら起動時にエラー）。`.env.example` と CI の build・E2E にダミーやテスト用の値を渡す

## 1. domain とリポジトリ

- [x] 1.1 `otpAbusePolicy`（`src/modules/identity/domain/services/`）のテストを先に書き、実装する: 再送の間隔、「アドレス × IP」の 5 通、1 つのコードの 3 回（最後の `sent` の後の `attempted`）、累積ロック（最後の `unlocked` より後、直近 24 時間の `attempted` が 10 件で `locked`、`locked` から 24 時間）、黙って送らないときの判定（「60 秒以内に同じアドレスに送っても 2 通目は送られない」「同じアドレス × IP の 6 通目は送られない」「失敗が 10 回に達するとその IP からはログインできない」の判定の部分）
- [x] 1.2 IP のキーを決める関数のテストを先に書き、実装する: 設定したヘッダだけを使う、IPv6 は /64、取れないときは `'unknown'`（「x-forwarded-for を変えても上限は変わらない」「同じ /64 の IPv6 は 1 つの IP として数える」の判定の部分）
- [x] 1.3 `OtpEventRepository` の実 DB のテストを先に書き、実装する: アドレスは HMAC で持つ、advisory lock の中で「INSERT → 数える」、30 日より古い行の掃除（「記録にはアドレスの平文が残らない」「30 日より古い記録は消える」「同時に照合を送っても 3 回までしか照合されない」「同時に照合を送っても 10 回でロックされる」）
- [x] 1.4 メールアドレスの正規化（A1 の `src/shared/schemas/email.ts`）を、アドレスの HMAC と送信・照合の前にかける関数にまとめる（2.1・2.2 の前提）。テストを先に書く（「大文字や前後の空白があっても同じユーザーになる」「全角の英数字は正規化して受け付ける」「正規化の後も ASCII 以外が残るアドレスは受け付けない」）

## 2. Better Auth の本体

- [x] 2.1 `src/infrastructure/auth/index.ts` を Better Auth で作り直す: drizzleAdapter（D3 のテーブルの対応）、emailOTP（`storeOTP: { hash }` で HKDF で導出した鍵の HMAC、`allowedAttempts: 3`、`expiresIn: 300`）、`rateLimit`（database、送信 3/分・20/日、照合 10/分）、`ipAddressHeaders`、セッション（30 日・1 日、cookieCache なし）、`trustedOrigins`、`nextCookies()`。実 DB のテストを先に書く（「届いたコードを入力するとログインできる」「未登録のアドレスはコードの照合でユーザーが作られる」「コードを送っただけではユーザーは作られない」「5 分を過ぎたコードではログインできない」「3 回まちがえるとコードが無効になる」「まちがったコードには不一致の文言を出す」「再送するとコードを送り直してログインできる」「使ったコードではもう一度ログインできない」「新しいコードを送ると古いコードは使えない」「DB には平文のコードが残らない」）
- [x] 2.2 hooks で `otpAbusePolicy` と `OtpEventRepository` をつなぐ。黙って送らないときは Better Auth の送信に進まず、同じ応答を返す。メールは `after()` で送る。テストを先に書く（「60 秒以内に同じアドレスに送っても 2 通目は送られない」「上限で見送った送信では本人の手元のコードが使える」「同じアドレス × IP の 6 通目は送られない」「別の IP からは同じアドレスに送れる」「失敗が 10 回に達するとその IP からはログインできない」「ロック中でも別の IP からはログインできる」「登録済みと未登録で応答が同じ」「アドレスの上限やロックで見送っても応答が同じ」「許可リストにないアドレスには送らない」「許可リストが未設定なら送信先を限らない」）
- [x] 2.3 IP ごとの上限のテストを先に書く（「同じ IP から 1 分に 4 通目は送られない」「同じ IP から 24 時間に 21 通目は送られない」「同じ IP から 1 分に 11 回目の照合は断る」「x-forwarded-for を変えても上限は変わらない」「同じ /64 の IPv6 は 1 つの IP として数える」）
- [x] 2.4 Turnstile の siteverify（`src/infrastructure/auth/turnstile.ts`。hostname と action を確かめる）を送信の hooks に入れる。`fetch` を差し替えたテストを先に書く（「Turnstile の確認に失敗したら送らない」「別のホストや別の action のトークンでは送らない」「Turnstile の確認に成功したら送る」）
- [x] 2.5 既存の Google ユーザーの紐付けの実 DB のテストを書く（「Gmail のアドレスでログインすると前のデータが見える」）

## 3. route とオリジンの確認

- [x] 3.1 `src/lib/security/origin.ts` のテストを先に書き、実装する（`Origin` が違う・`null`・`Sec-Fetch-Site: cross-site` で 403、`Origin` も `Sec-Fetch-Site` もなければ通す）
- [x] 3.2 `src/app/api/auth/[...all]/route.ts` を作り（`[...nextauth]` を消す）、許可リストにないパスは 404、送信の `type` が `sign-in` 以外は 400、POST にオリジンの確認をかける。テストを先に書く（「許可していないパスは 404 になる」「ログイン以外の種類のコードの送信は断る」「許可したパスは動く」「別のオリジンからのログインは 403 になる」「Origin が null のリクエストは 403 になる」）
- [x] 3.3 tRPC の route の POST にオリジンの確認をかけ、`createContext` を `auth.api.getSession` に置き換える。テストを先に書く（「別のオリジンからの mutation は 403 になる」「Origin が null のリクエストは 403 になる」「同じオリジンからの mutation は処理される」「セッションがないと保護された API は 401 になる」「ログインすると tRPC でそのユーザーとして扱われる」「切り替え前の Auth.js の Cookie ではログインしていない扱いになる」「セッションの Cookie の属性」「ログアウトした後は控えておいた Cookie も使えない」）

## 4. クライアント

- [x] 4.1 `src/infrastructure/auth/client.ts`（`createAuthClient` + `emailOTPClient`）と `AuthContext` の置き換え（`status` を足す、`login()` はログイン画面へ、`logout()` は今と同じくログイン中だけの状態を消してから `signOut`）。テストを先に書く（「ログアウトするとゲストに戻り、保護されたデータが見えない」）
- [x] 4.2 戻り先の検証の関数のテストを先に書き、実装する（「ログインの前にいた画面に戻る」「戻り先に別のサイトは指定できない」）
- [x] 4.3 ログイン画面（メール → コードの 2 段階、非表示の Turnstile、再送の 60 秒、エラーの文言、オフライン、移行の案内）のテストを先に書き、実装する（「ログイン画面に Google のボタンがない」「オフラインではコードを送れない」「送信から 60 秒は再送できない」「ログイン画面に移行の案内が出る」）。設定・グループの画面の「Googleでログイン」を「ログイン」に変える。`next.config.ts` の `lh3.googleusercontent.com` の `remotePatterns` は、Auth.js に戻すときのために残し、A6 で消す
- [x] 4.4 `src/lib/security/headers.ts` の Report-Only の `script-src`・`frame-src` に `https://challenges.cloudflare.com` を足し、テストを直す

## 5. E2E

- [x] 5.1 `src/app/api/test/otp/route.e2e.ts` のテストを先に書き、実装する（「条件がそろうとテスト用のルートが直近のコードを返す」「条件が 1 つでも欠けるとテスト用のルートは 404 になる」「本番のビルドの NODE_ENV でも条件がそろえばテスト用のルートが動く」「E2E_BUILD なしのビルドではコードを手元に持たない」）
- [x] 5.2 `e2e-credentials.ts` を消し、`e2e/auth/fixtures` のログインのヘルパーを「送信 → テスト用のルート → `sign-in/email-otp` → storageState」に作り直す（テストごとに別の `x-real-ip`）。`playwright.config.ts` の `AUTH_TRUST_HOST` を `BETTER_AUTH_URL` に置き換える（「メールアドレスだけではログインできない」）
- [x] 5.3 ログインの E2E（`e2e/auth/login.spec.ts`）を書く: 新しいアドレスでログイン、既存のユーザーでログイン、3 回まちがえて再送、ログアウト、ゲストのデータの取り込み（「ログインするとゲストのデータが取り込まれる」と、1・4 の Scenario の画面の側）
- [x] 5.4 既存の `e2e/auth/**` が新しいヘルパーで全件通ることを確かめる
- [x] 5.5 `next-auth`・`@auth/drizzle-adapter`・`src/types/next-auth.d.ts`（あれば）と、Auth.js の import の残りを消す。`npm ls` で @simplewebauthn ^9 の peer が残っていないことを確かめる

## 6. 確認

- [x] 6.1 `npm run lint`・`npm run test:run`・`npm run test:db`・`npm run build`・`npm run test:e2e:local` が通る
- [x] 6.2 ブラウザで Report-Only の CSP の違反が出ないことを確かめる（ログイン画面と Turnstile）
- [x] 6.3 リリースに要る外の作業を書き出す（レビュー M3）: Vercel の Production・Preview に入れる環境変数の一覧（`BETTER_AUTH_SECRET`・`BETTER_AUTH_URL`・`BETTER_AUTH_TRUSTED_ORIGINS`（Preview）・`OTP_EVENT_HMAC_KEY`・`TURNSTILE_SECRET_KEY`・`NEXT_PUBLIC_TURNSTILE_SITE_KEY`・`RESEND_API_KEY`・`EMAIL_FROM`・`EMAIL_RECIPIENT_ALLOWLIST`（Preview））と、ユーザーの作業（Turnstile のウィジェットを本番と Preview のホストで作る、Resend の `mail.counoco.net` の検証、Preview の Deployment Protection）を `docs/INFRASTRUCTURE.md` に足す。設計書の「Preview での確認チェックリスト」の R1b の項目を、AR1b の PR の本文に写せる形で用意する。確認項目に「偽の `x-real-ip`・`x-forwarded-for` を付けた送信で、記録される IP（`otp_events.ip`・`rate_limits.key`）がクライアントの値にならないこと」を入れる（D4。一時的なルートは作らず、既存の送信の記録で確かめる）
