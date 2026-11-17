# Better Auth 用テーブルの expand マイグレーション（A2）

Issue: #61（設計: docs/features/passkey-email-auth.md の「### DB スキーマ（Drizzle）— expand / contract の 2 段階」「## 実装ステップ」A2）

## Why

A3 で Auth.js から Better Auth に切り替える。本番では migrate と Vercel のデプロイが互いを待たないので、新しいテーブル・列を先に足し、旧コード（Auth.js）と新コードのどちらでも動く状態を作っておく（expand）。

## What Changes

- `users` に `email_verified_flag boolean NOT NULL DEFAULT false` を足し、`email_verified`（timestamp）が入っている行を true にする
- `users.email` を `lower(trim(email))` にそろえる。そろえると重複する行があれば `RAISE EXCEPTION` で止める（何も変えない）
- `users.name` の NULL を `''` にする（制約は付けない）
- 新しいテーブル: `auth_sessions`・`auth_accounts`・`auth_verifications`・`passkeys`・`rate_limits`・`otp_events`
- `schema.ts` に同じ定義を足す（key は Better Auth のフィールド名）

足すだけで、削除・名前の変更・型の変更はしない。Auth.js のテーブル（`accounts`・`sessions`・`verification_tokens`）と `users.email_verified`・`users.image` は残す（A6 の contract で消す）。

## Capabilities

### New Capabilities

なし（振る舞いの差分がないので `skip_specs: true`）

### Modified Capabilities

なし

## Non-goals

- Better Auth の導入とテーブルの利用（A3）。パスキーの利用（A5）
- 旧テーブル・旧列の削除、`users.name` の NOT NULL（A6 の contract）
- 本番の migrate（main へのリリースのとき、リーダーがユーザーの確認を取って先に流す。`.claude/rules/team-operation.md` の「DB の変更を含むリリース」）

## 影響するモード

ログイン中（サーバーファースト・ローカルファースト）の DB だけ。動きは変わらない。ゲストには影響しない。

## Impact

- `src/infrastructure/db/drizzle/schema.ts`、`migrations/0006_auth_tables_expand.sql`（手で書いた SQL）と `meta/`
- 実 DB のテスト `src/infrastructure/db/drizzle/__tests__/auth-tables-expand-migration.db.test.ts`
- リリース: DB の変更を含むので、develop → main のときに本番の migrate を先に流す（expand なので旧コードのまま当ててよい）
