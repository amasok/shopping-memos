# Tasks

ユーザーの確認が済み、`62-o7-catalog-local-first` が archive されてから始める。各タスクは RED → GREEN → REFACTOR の順。

## 1. 並び

- [x] 1.1 `catalogQueries.ts` のテストを先に直し（catalog「ゲストの商品の並びもサーバーと同じ作成日時の古い順」「ゲストのタグも名前の文字コードの順に出す」）、`order` の分岐をなくす
- [x] 1.2 並びに頼る E2E（`e2e/item-management.spec.ts`・`tag-management.spec.ts` など）を確かめ、期待値を直す

## 2. `/items/new`

- [x] 2.1 `app/items/new/page.tsx` を消し、`src/lib/sw/config.ts` のプリキャッシュの一覧から外す。使われなくなった `lib/db` の関数を消す。プリキャッシュの設定のテストが通ることを確かめる

## 3. 確認

- [x] 3.1 `npm run lint`・`npm run test:run`・`npm run test:coverage`（80% 以上）・`npm run build` が通る
- [x] 3.2 `npm run test:e2e:local` を全部流し、プロジェクトごとの件数を tester の報告に書く

## Workflow follow-up

- tester の結果と reviewer の LGTM がそろったら archive してコミットする（タスクにしない）。`62-o7-catalog-local-first` の archive の後に行う
