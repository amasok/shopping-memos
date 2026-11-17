## 1. メールアドレスの正規化

- [x] 1.1 `src/shared/schemas/__tests__/email.test.ts` を書く（NFKC・trim・小文字化、ASCII 以外・形式違反・長すぎるものの拒否）
- [x] 1.2 `src/shared/schemas/email.ts` を実装する

## 2. 文面

- [x] 2.1 `templates/__tests__` を書く（日本語の本文、コード、有効期限、URL を含まない、HTML のエスケープ、不正なコードの拒否）
- [x] 2.2 `templates/otp.ts`・`templates/notice.ts`・`templates/escape.ts` を実装する

## 3. 送信の実装

- [x] 3.1 `ResendEmailSender` のテストを書く（fetch をモック。宛先・件名・本文・認証ヘッダ、失敗時に `EmailSendError`、キーとコードがエラーに出ない）
- [x] 3.2 `ConsoleEmailSender`・`TestMailboxEmailSender`・許可リストのテストを書く
- [x] 3.3 3 つの実装と許可リストのラッパーを実装する

## 4. 環境変数と送り方の選択

- [x] 4.1 `env.ts` のテストを書く（E2E → TestMailbox、キーあり → Resend、本番・Vercel でキーなし → エラー、開発 → Console、`EMAIL_FROM` の形式、許可リストの解釈）
- [x] 4.2 `env.ts`・`index.ts` を実装する

## 5. 確認

- [x] 5.1 `npm run lint`・`npm run test:run`・`npm run build` が通る
- [x] 5.2 tester に `npm run test:e2e:local` を全部流してもらう（振る舞いは変えないので失敗 0 のはず）
