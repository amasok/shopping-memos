# メール送信の基盤（A1）

Issue: #61（設計: docs/features/passkey-email-auth.md の「### 3. メール送信サービス」「## 実装ステップ」A1）

## Why

#61 で Google OAuth をやめ、メールのワンタイムコード（OTP）でログインする。その前に、OTP やパスキーの通知を送る仕組みを、送信サービス（Resend）から切り離した形で用意しておく。テストと E2E では送信を差し替えられる必要がある。

## What Changes

- `EmailSender` のインターフェース（`sendOtp` / `sendNotice`）と、3 つの実装を足す
  - `ResendEmailSender`: Resend の REST API（`POST https://api.resend.com/emails`）を fetch で呼ぶ。SDK（`resend` パッケージ）は足さない
  - `ConsoleEmailSender`: ローカルの開発用。コードをサーバーのログに出す
  - `TestMailboxEmailSender`: E2E 用。直近のコードと通知を `globalThis` の Map に持つ
- 送信先の許可リスト（`EMAIL_RECIPIENT_ALLOWLIST`、Preview だけで使う）のラッパー。リスト外には送らず、呼び出し側には送ったのと同じに見せる
- メールの文面（日本語）: OTP、パスキーの追加・削除の通知、OTP ログインの制限の通知、管理者への送信数のアラート。URL を含めない。HTML はエスケープする
- メールアドレスの正規化（NFKC → trim → 小文字化 → 形式の検証。ASCII 以外は拒否）を `src/shared/schemas/email.ts` に置く
- 環境変数（`RESEND_API_KEY`・`EMAIL_FROM`・`EMAIL_RECIPIENT_ALLOWLIST`・`OTP_ALERT_EMAIL`）の Zod の検証と、環境に応じた送り方の選択（`createEmailSender`）

まだどこからも呼ばない。ログインの動きは変わらない（Auth.js のまま）。

## Capabilities

### New Capabilities

なし（振る舞いの差分がないので `skip_specs: true`。OTP ログインの振る舞いは `61-a3-email-otp-login` の specs に書く）

### Modified Capabilities

なし

## Non-goals

- Better Auth の導入、OTP の生成・保存・照合、レート制限（A3）
- Resend のアカウント・ドメインの設定（ユーザーの作業。設計書の「## 未確定事項」）
- `BETTER_AUTH_SECRET`・`OTP_EVENT_HMAC_KEY`・Turnstile などの環境変数（A3 で足す）

## 影響するモード

ゲスト・サーバーファースト・ローカルファーストのどれにも影響しない（サーバーの新しいモジュールを足すだけで、まだ使わない）。

## Impact

- 新規: `src/infrastructure/auth/email/**`、`src/shared/schemas/email.ts` とそのテスト
- 依存: 足さない（fetch で REST API を呼ぶ）
- 環境変数: Vercel への設定は A3 のリリースのとき（いまは読まれない）
