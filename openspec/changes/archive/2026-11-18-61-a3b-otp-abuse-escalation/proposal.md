# Proposal: 狙われたアドレスを対話型のチャレンジに切り替え、本人に知らせる

Issue: #61（https://github.com/amasok/shopping-memos/issues/61）

**状態: 承認済み（2026-11-18）**。ユーザーが `61-a3-email-otp-login` を「提案どおり承認」した後に、その中の A3b の分を、中身を変えずにこの change に移した（1 つの change を 1 つの PR で archive するため。`61-a3-email-otp-login` の design の D7）。

## Why

A3a（`61-a3-email-otp-login`）の「アドレス × IP」の上限と累積ロックは、多数の IP から 1 つのアドレスを狙われると効かない。止めると、攻撃者が家族のログインを止められてしまう。承認済みの方針（`docs/features/passkey-email-auth.md` の「OTP 送信の乱用対策」、決定事項 7）どおり、止めずに対話型の Turnstile に切り替え、本人に知らせ、本人のログインで解除する。あわせて Resend の枠を使い切る前に管理者が気づけるようにする。

## What Changes

- 1 つのアドレスへの送信が 24 時間に 20 通、または照合の失敗が 30 回に達したら、そのアドレスへの送信に対話型の Turnstile を必須にする（チャレンジ用の secret でだけ確かめる）
- ロック・チャレンジの段階に入った登録済みのアドレスに、24 時間に 1 通まで通知を送る。ログインに成功したら、そのアドレスのロック・チャレンジ・失敗の回数を解除する
- 24 時間の送信が 70 通を超えたら、管理者に 1 回知らせる

## Capabilities

### New Capabilities

なし

### Modified Capabilities

- `auth`: 「狙われたアドレスへの対話型のチャレンジ」「制限の通知と解除」「送信数の監視」を足す

## 影響するモード

ログインの画面とサーバーだけ。ゲスト・サーバーファースト・ローカルファーストのデータの扱いは変わらない。

## Non-goals

- `61-a3-email-otp-login` の Non-goals と同じ

## Impact

- 依存: `61-a3-email-otp-login`（A3a）が develop に入っていること
- 変更: `src/modules/identity/domain/services/otpAbusePolicy.ts`、`src/infrastructure/auth/index.ts`（hooks）、`src/infrastructure/auth/turnstile.ts`、`src/app/login/page.tsx`（対話型のウィジェット）
- 環境変数: `TURNSTILE_CHALLENGE_SECRET_KEY`・`NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY`・`OTP_ALERT_EMAIL`
- DB の migration: なし（`otp_events` の `notified`・`alerted` は A2 で作る）
