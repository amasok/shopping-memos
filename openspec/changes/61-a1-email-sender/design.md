# 設計

## 置き場所

- `src/shared/schemas/email.ts`: メールアドレスの正規化と Zod のスキーマ。ログイン画面（クライアント）と Better Auth のフック（サーバー）で共用する（A3）
- `src/infrastructure/auth/email/`: 送信の実装（サーバーだけ）
  - `EmailSender.ts`: インターフェースと型（`OtpType`・`EmailNotice`）
  - `templates/`: 文面（`otp.ts`・`notice.ts`・`escape.ts`）
  - `ResendEmailSender.ts`・`ConsoleEmailSender.ts`・`TestMailboxEmailSender.ts`
  - `allowlist.ts`: 送信先の許可リストのラッパー
  - `env.ts`: 環境変数の検証と送り方の選択
  - `index.ts`: `createEmailSender(env)`（A3 の Better Auth の設定から呼ぶ）

## 決めたこと

- **Resend の SDK を使わない**: 呼ぶのは「メールを 1 通送る」API だけで、fetch で足りる。SDK は `postal-mime`・`standardwebhooks` と `@react-email/render`（peer）を引き込む。テストでは fetch を差し替える
- **インターフェースは用途ごとのメソッド**（`sendOtp` / `sendNotice`）にする。TestMailbox がコードを構造のまま持てるようにするため（本文からコードを抜き出さない）
- **送り方の選び方**（`resolveEmailMode`）
  1. `E2E_BUILD=true` のビルド（next.config.ts の `env` でビルド時に埋め込まれる `process.env.E2E_BUILD`）で、E2E の実行時条件（`isE2ERuntimeEnabled`。`E2E_TEST`・`VERCEL_ENV`・`E2E_SEED_TOKEN`）を満たす → TestMailbox。#70 と同じ二重の守りで、本番ビルドで `E2E_TEST` を誤って設定しても、メールが Map に入って届かない状態にしない
  2. `RESEND_API_KEY` がある → Resend（`EMAIL_FROM` も必須）
  3. Vercel 上（`VERCEL_ENV` が `development` 以外）か `NODE_ENV=production` でキーがない → エラー（起動時に気づく。本番でコードをログに出さない）
  4. それ以外（ローカルの `next dev`）→ Console
- **許可リスト**: `EMAIL_RECIPIENT_ALLOWLIST`（カンマ区切り、正規化して比べる）があれば、どの送り方でもリスト外には送らない。送らなかったことはログに出すが、宛先は出さない
- **エラー**: Resend の失敗は `EmailSendError`（HTTP ステータスだけを持つ）で投げ、握りつぶさない（A3 が受け止めてログに出し、利用者への応答は送れたときと同じにする）。API キー・宛先・本文・コードをメッセージに入れず、Resend の応答の本文も読まない。タイムアウトは 10 秒
- **ログ**: 宛先とコードを出すのは、ローカルの `next dev` だけで選ばれる Console だけ（コードを見るのが目的のため）。許可リストで送らなかったときのログには宛先を出さない
- **文面**: 件名と本文にユーザーの入力を入れない（パスキーの名前だけは本文に入れ、HTML はエスケープし、改行は除く）。コードは `^\d{6}$` 以外を拒否する。URL を含めない（フィッシングとの区別のため。設計書「OTP メールテンプレート」）
- **メールアドレスの正規化**: NFKC → trim → 小文字化 → ASCII だけか → Zod の `z.email()` → 254 文字まで。正規化の後の値を返す（設計書「## セキュリティ」）

## DB

なし。
