# 設計

## expand / contract

expand だけ。足す列は既定値つき、新しいテーブルは旧コードから参照されない。データの更新は次の 3 つで、どれも旧コードの動きを変えない。

| 更新 | 旧コードへの影響 |
|------|----------------|
| `email` を `lower(trim(email))` に | Google が返すアドレスは小文字なので、通常は変化しない。Auth.js はログインのたびに `email` で `users` を引くが、小文字のアドレスで引くので一致する |
| `email_verified_flag` を写す | 旧コードは列を知らない（INSERT では既定値 false） |
| `name` の NULL を `''` に | セッションは JWT で、名前はログインの時点のもの。グループのメンバー一覧は NULL も `''` も空で表示する |

## 決めたこと

- **冪等にする**（0005 と同じ）。`CREATE TABLE IF NOT EXISTS`、`ADD COLUMN IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`。外部キーは CREATE TABLE の中に書く（`ADD CONSTRAINT` は IF NOT EXISTS を書けないため）
- **重複の確認を最初に**行う。drizzle は 1 トランザクションで流すので、止まれば何も変わらない
- `lock_timeout = '5s'`（0005 と同じ。users の行ロックの後ろにアプリのクエリが詰まらないように）
- **列名は Better Auth の既定のフィールド名の snake_case**、key はフィールド名（`drizzleAdapter` が key で引く。passkeys の `credentialID` も key のまま）。時刻は既存と同じ `timestamp`（タイムゾーンなし）
- **インデックス**: 各テーブルの `user_id`、`auth_verifications.identifier`、`otp_events` に `(email_hash, kind, created_at)`・`(email_hash, ip, kind, created_at)`（61-a3 の D4 の数え方。kind ごとに直近 24 時間を数える）と `(kind, created_at)`（全体の送信数の監視と 30 日より古い行の削除）
- **一意**: `auth_sessions.token`・`passkeys.credential_id`・`rate_limits.key`
- `otp_events`（planner と合わせた。61-a3 の D4）
  - `kind` は CHECK で `sent` / `attempted`（照合の前に記録）/ `locked` / `unlocked` / `notified`（本人への制限の通知）/ `alerted`（管理者への知らせ）に限る。後から CHECK を直すと migration がもう 1 本要るので、A3b で使う値も先に入れる
  - `ip` は NOT NULL。取れないときはアプリが `'unknown'` を入れる（NULL だと `(email_hash, ip)` の照合が効かない）
  - `email_hash` は `alerted` のときだけ NULL を許す（CHECK `kind = 'alerted' OR email_hash IS NOT NULL`）
- `passkeys.created_at` は NOT NULL・既定値 now()。`users.updated_at` には drizzle の `$onUpdate` を付ける（SQL は変わらない）
- 列は Better Auth 1.7.25 の CLI（`npx auth@1.7.25 generate`）の出力と planner が照らし合わせた。ただし `users.name` は NULL 可のまま（A6 で NOT NULL）、`passkeys.credential_id` は unique、`rate_limits.key` は unique（同時作成の対策）。better-auth は A2 では package.json に入れない（A3）
- `rate_limits` は Better Auth の `rateLimit` モデル（`id`・`key`・`count`・`last_request`）。A3 で `rateLimit.modelName` を `rateLimits` にする
- **NFKC は SQL ではかけない**（設計書どおり `lower(trim())`）。アプリ側の正規化（A1 の `normalizeEmail`）は NFKC もかけるが、既存の行は Google のアドレス（ASCII の小文字）なので差は出ない

## migration の順番とリリース

- 0006 は 0005 の後。develop → main のリリースで、Vercel の本番デプロイより前に本番の migrate を流す（team-operation.md の「DB の変更を含むリリース」）。expand なので、A3 より前のリリースで当ててよい
- 旧コードとの互換は、このブランチ（コードは Auth.js のまま）で `npm run test:e2e:local` を全部流して確かめる（設計書の L-10 に当たる）

## 既知の差（害はない）

- 0006 を本番に当ててから A3 を出すまでの間に Auth.js が作ったユーザーは、`email_verified` が入っていても `email_verified_flag` は false のまま（0006 の写しは当てた時点の行だけ）。Better Auth はコードでのログインに成功したときに true にするので、実害はない
