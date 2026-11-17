## 1. テスト

- [x] 1.1 `auth-tables-expand-migration.db.test.ts` を書く（0000〜0005 に Google ユーザー・グループ・アイテムを入れて 0006 を当てる。行と ID が残る、email の正規化、flag の写し、name の ''、旧テーブル・旧列が残る、旧コードの書き方で書ける、新テーブルの FK cascade・一意・CHECK・インデックス、冪等、重複で失敗して何も変わらない）

## 2. スキーマと migration

- [x] 2.1 `schema.ts` に `users.emailVerifiedFlag` と 6 つのテーブルを足す
- [x] 2.2 `drizzle-kit generate` で下書きを作り、`0006_auth_tables_expand.sql` を手で直す（重複の確認、正規化、flag の写し、name の ''、冪等）
- [x] 2.3 `drizzle-kit generate` をもう一度流し、「No schema changes」になる（schema.ts と snapshot が一致）
- [x] 2.4 migrate-production.yml の contract の検出パターンに当たらない

## 3. 確認

- [x] 3.1 `npm run test:db` が通る
- [x] 3.2 `npm run lint`・`npm run test:run`・`npm run build` が通る
- [x] 3.3 tester に `npm run test:e2e:local` を全部流してもらう（expand を当てた DB で旧コードが動く）
