# Proposal: Google ログインをやめ、メールアドレスとワンタイムコードでログインする

Issue: #61（https://github.com/amasok/shopping-memos/issues/61）

**状態: 承認済み（2026-11-18、ユーザーが「提案どおり承認」。下の「ユーザーに確認すること」4 点も提案どおり）**。方針（Better Auth・6 桁のコード・Resend・Turnstile・一括切り替え・独自ドメイン）は 2026-11-16 にユーザーが承認済み（`docs/features/passkey-email-auth.md` の「決定事項」）。この change は #61 の A3a（Better Auth への切り替えとメールのコードでのログイン）の振る舞いを書く。承認を取ったときはこの change に A3b の分も入っていたが、承認の後に、中身を変えずに `61-a3b-otp-abuse-escalation` に移した（1 つの change を 1 つの PR で archive するため。design の D7）

## Why

今のログインは Google だけで、Google アカウントのない家族が使えない。また Auth.js は保守がほぼ止まり、セッション（JWT）はサーバーから失効できない（#73-8）。承認済みの方針どおり、Better Auth に移り、メールアドレスに届く 6 桁のコードでログインできるようにする。パスキー（A5）は、このログインの上に後から足す。

## What Changes

- **BREAKING**: Google でのログインをなくす。切り替えのリリースで、今の Auth.js のセッションは読めなくなり、全員が 1 回ログアウトされる
- ログイン画面を「メールアドレスの入力 → 6 桁のコードの入力」の 2 段階にする。未登録のアドレスなら、そのままアカウントを作る（サインアップとログインを分けない）
- コードは 5 分で失効し、3 回まちがえると無効になる。DB にはハッシュだけを持つ
- 送信の結果（ステータス・本文）を、登録の有無・上限・ロックで変えない（アドレスの存在を分からないようにする）
- Cloudflare Turnstile（ボット対策）を送信フォームに付け、サーバーで確かめる
- 送信の上限: IP ごと（3 通/分・20 通/日）、アドレスごとの再送の間隔（60 秒）、「アドレス × IP」ごとの上限と、失敗の累積によるロック。上限に達したアドレスを対話型の Turnstile の段階に入れること・本人への通知と解除・送信数の監視は `61-a3b-otp-abuse-escalation`（A3b）で行う
- 既存の Google ユーザーは、同じメールアドレスでログインすれば同じユーザー（`users.id`）になり、データがそのまま見える
- セッションを DB のセッションに変える（30 日、使っている間は延長）。ログアウトはすぐ効く（設計書にあった 5 分の Cookie のキャッシュは使わない）
- tRPC の mutation と認証の API の POST で、別のオリジンからのリクエストを断る（#71 の残り。ログインの CSRF も防ぐ）
- 認証の API は、使うもの（コードの送信・コードでのログイン・セッションの取得・ログアウト）だけを開き、ほかは 404 にする
- E2E のログインを、E2E 用の Credentials（メールアドレスだけでログイン）から、テスト用のルートでコードを受け取る本物のコードのログインに変える
- Preview 環境では、許可リストにないアドレスにメールを送らない

## Capabilities

### New Capabilities

- `auth`: ログイン・ログアウト・セッション・メールのコードの送信と照合・乱用の制限・既存ユーザーの紐付け・E2E 用のログインの守り。今の振る舞いのうち、この change で触れる範囲（ログアウトするとゲストに戻る、ログインしていないと保護された API が 401）も書き起こす

### Modified Capabilities

なし

## 影響するモード

| モード | 影響 |
|-------|------|
| ゲスト（Dexie だけ） | ログインしていない間は変わらない。ログインの入口（設定・グループの画面のボタン）が Google からメールのログイン画面に変わる |
| サーバーファースト（tRPC） | ログインの方法とセッションが変わる。tRPC の `Context`（`userId` など）の形は変えないので、ルーターは変わらない。ログイン後のゲストのデータの取り込み（`DataMergeContext`）は今と同じく動く |
| ローカルファースト（`NEXT_PUBLIC_LOCAL_FIRST`） | サーバーファーストと同じ。オフライン時のセッションの扱い（`status: "offline"`）は #62 の O9 で足す。この change の `AuthContext` は、O9 がそれを足せる形にしておく |

## Non-goals

- パスキー（A5）、初回の表示名の設定と設定画面のアカウント欄・「すべての端末からログアウト」（A4）
- 古いテーブル（`sessions`・`accounts`・`verification_tokens`）と `users.email_verified` の削除（A6 の contract）
- メールアドレスを変える機能
- CSP を Report-Only から強制に切り替えること（Google のログインがなくなった後に、別の Issue で行う。この change では Turnstile のための許可だけを足す）
- オフライン時のセッションの保持（#62 の O9）
- 切り替え前の告知バナー（設計書の A0）。やめて、家族に直接連絡し、ログイン画面に移行の案内を出す（リーダーの判断、2026-11-18）

## Impact

- 依存: A1（メール送信の基盤。change `61-a1-email-sender`）と A2（Better Auth のテーブルの expand。change `61-a2-auth-tables-expand`）が先に develop に入っていること
- 追加: `better-auth@1.7.25`・`@better-auth/passkey@1.7.25`（A5 で使う。design の D1）。入れるには先に vite 8 への更新が要る（D1）。削除: `next-auth`・`@auth/drizzle-adapter`
- 変更: `src/infrastructure/auth/**`（作り直し）、`src/app/api/auth/[...all]/route.ts`（`[...nextauth]` を置き換え）、`src/infrastructure/trpc/server.ts`（`createContext`）、`src/app/api/trpc/[trpc]/route.ts`（オリジンの確認）、`src/contexts/AuthContext.tsx`、`src/app/login/page.tsx`、`src/app/settings/page.tsx`・`src/app/groups/page.tsx`（文言）、`src/lib/security/headers.ts`（Turnstile の CSP）、`e2e/auth/fixtures/**`・`playwright.config.ts`
- 新規: `src/app/api/test/otp/route.e2e.ts`（E2E 専用）、`otp_events` を読み書きするリポジトリ
- 削除: `src/infrastructure/auth/e2e-credentials.ts`
- DB の migration: なし（テーブルは A2 で作る）
- 環境変数: `BETTER_AUTH_SECRET`・`BETTER_AUTH_URL`・`OTP_EVENT_HMAC_KEY`・`OTP_ALERT_EMAIL`・`TURNSTILE_SECRET_KEY`・`TURNSTILE_CHALLENGE_SECRET_KEY`・`NEXT_PUBLIC_TURNSTILE_SITE_KEY`・`NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY`・`EMAIL_RECIPIENT_ALLOWLIST`（Preview のみ）。Google と Auth.js の変数は A6 まで残す（戻すときに要るため）
- 実装は 2 つの PR に分ける（design の D7）。この change は A3a。A3b は `61-a3b-otp-abuse-escalation`。main へは両方と A4 が develop に入ってから出す

## ユーザーに確認すること

specs は各項目の「提案」で書いている。違う答えなら specs を直す。

1. **告知バナー（A0）をやめる**: 切り替え前にアプリ内でバナーを出す代わりに、家族に直接連絡し、切り替え後のログイン画面に案内を出す
   - 提案: このとおり（対象は 1 家族なので、バナーの PR を出してリリースする手間に見合わない）
2. **ログイン画面の移行の案内の文言**: 「ログイン方法が変わりました。以前 Google で使っていた Gmail のアドレスを入力してください」（A6 で消す）
   - 提案: このとおり
3. **エラーの文言**: コードの不一致「コードが正しくありません」、期限切れ・試行の上限「コードの有効期限が切れました。再送信してください」、送信の上限「しばらく時間をおいてからお試しください」、オフライン「オフラインのためログインできません」（ボタンを押せなくする）
   - 提案: このとおり（設計書の UI フローと同じ。ただし「残り N 回」は出さない。3 回しかないので出す意味が薄く、出すにはライブラリの外で数える実装が増えるため）
4. **CSP の強制は別の Issue にする**: Google のログインがなくなった後に、CSP を Report-Only から強制に切り替える（#61 の実装メモ）。この change に入れると、違反を確かめる期間なしに本番で強制することになる
   - 提案: AR1b（切り替えのリリース）の 1 週間後を目安に、Report-Only の違反がないことを確かめてから、別の Issue で強制にする
