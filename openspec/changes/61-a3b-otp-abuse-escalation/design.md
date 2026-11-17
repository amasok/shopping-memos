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

## Risks / Trade-offs

- [通知で第三者に迷惑をかける] → 登録済みのアドレスだけ、24 時間に 1 通まで
