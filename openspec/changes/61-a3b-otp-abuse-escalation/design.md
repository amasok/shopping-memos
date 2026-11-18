# Design: 狙われたアドレスへのチャレンジ・通知・監視

## Context

数え方・ロック・Turnstile の secret の分け方・通知の条件は、`61-a3-email-otp-login` の design の D4（archive の後は `openspec/changes/archive/<日付>-61-a3-email-otp-login/design.md`）で決めてある。この change はその残りを実装する。

## Goals / Non-Goals

**Goals:** proposal の What Changes。**Non-Goals:** A3a で決めた上限の値や数え方を変えること。

## Decisions

- チャレンジの判定は `otpAbusePolicy` に足す。アドレスの直近 24 時間の `sent` が 20 件、または最後の `unlocked` より後の `attempted` が 30 件で、チャレンジの段階にする。登録の有無は見ない（列挙対策）
- チャレンジの段階で非表示のウィジェットのトークンが来たら、メールを送らずに「チャレンジが要る」と応答する。応答は登録の有無で変えない。ログイン画面は、その応答で対話型のウィジェット（`NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY`）を出して送り直す
- 通知は、登録済みのアドレスで、直近 24 時間に `notified` がないときだけ送り、`notified` を記録する。送るのは Next.js の `after()` で、応答を待たせない
- 解除は `hooks.after`（`ctx.context.newSession` があるとき）で `unlocked` を記録する。送信の数（5 通・20 通）は区切らない
- 監視は送信の後に、直近 24 時間の `sent` が 70 件を超え、直近 24 時間に `alerted` がなければ、`alerted` を記録して管理者に送る。同時の送信で 2 通送らないよう、`alerted` の判定も A3a と同じ advisory lock（キーは固定の値）の中で行う
- テスト用のキーは常に成功するので、チャレンジの Scenario はユニットテスト（siteverify の `fetch` を差し替える）で確かめる

## 実装で決めたこと（2026-11-18）

- 送信の hooks の順: 種類 → 正規化 → **チャレンジの段階かを読む（`addressCounts` → `requiresChallenge`）。段階なら本人に通知** → 段階に応じた secret で Turnstile（`verifyTurnstileToken` の `challenge`）→ IP の 24 時間 → 許可リスト → `guardSend` → 送ったら監視（`checkAlert`）
- チャレンジの段階で確かめられなければ 403 `TURNSTILE_CHALLENGE_REQUIRED`（段階でなければ今までどおり `TURNSTILE_FAILED`）。段階は登録の有無を見ない数だけで決まるので、応答で登録の有無は分からない。ログイン画面はこのコードで対話型のウィジェットを出す
- 照合の hooks: `guardVerify` が照合に進めたとき、ロックを記録した（`locksAfter`）か、失敗が 30 回に達してチャレンジの段階になったら、本人に通知する
- 通知は `OtpEventRepository.notifyOnce`（アドレスの advisory lock の中で、`users` で登録済みかを見て、直近 24 時間の `notified` がなければ記録）。監視は `checkAlert`（固定のキー `otp-events:alert` の advisory lock の中で、直近 24 時間の `sent` を数え、直近 24 時間の `alerted` がなければ記録。`alerted` の `email_hash` は NULL）。メールは `runInBackground`（Next.js の `after()`）で送り、失敗はログだけ
- ロックの解除: `isLocked` は、最後の `unlocked` より後の `locked` だけをロック中とする。`unlocked` は A3a からログインの成功のたびに記録している
- 本番は `OTP_ALERT_EMAIL` を必須にした（`resolveEmailConfig`）。Turnstile のチャレンジ用の secret とサイトキーは、本番・Vercel で必須、本番ではテスト用のキーを拒否
- 本番では、対話型のウィジェットの secret・サイトキーが非表示のものと同じ値なら起動時にエラー（同じだと、チャレンジの段階でも非表示のトークンが通るため）。ウィジェットのモード（対話型は Managed）は Cloudflare の管理画面でしか決まらないので、INFRASTRUCTURE.md のユーザーの作業に書いた
- 監視（`checkAlert`）も応答と切り離して `after()` で動かす（送ったときだけトランザクションが増えて、見送ったときとの時間の差が広がらないように）。判定の時刻より後の行は数えない
- 通知の文面は specs の文言（「ログインの試行が繰り返されたため、一時的に制限しました。心当たりがなければ問題ありません」）に合わせた

## Risks / Trade-offs

- [通知で第三者に迷惑をかける] → 登録済みのアドレスだけ、24 時間に 1 通まで
