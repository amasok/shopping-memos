# Tasks

ユーザーの確認が済み、`62-o8-shopping-local-first` が archive されてから始める。

## 1. 並び

- [x] 1.1 `shoppingQueries.ts` のテストを先に直し（shopping「ゲストのリストとリストの商品もサーバーと同じ作成日時の古い順」）、`order` の分岐をなくす

## 2. 確認

- [x] 2.1 `npm run lint`・`npm run test:run`・`npm run test:coverage`（80% 以上）・`npm run build` が通る
- [x] 2.2 `npm run test:e2e:local` を全部流し、プロジェクトごとの件数を tester の報告に書く

## Workflow follow-up

- tester の結果と reviewer の LGTM がそろったら archive してコミットする（タスクにしない）。`62-o8-shopping-local-first` の archive の後に行う
