# Tasks

ユーザーの確認が済み、`179-shopping-domain-rules` が archive されてから始める。各タスクは RED → GREEN → REFACTOR の順。かっこ内は、そのタスクでテストを書く specs の Scenario。

## 1. domain の変更

- [ ] 1.1 `planFinishShopping` のテストに `no_checked_items` を足してから実装する（「tRPC にチェック 0 件の完了が届くと断る」の domain 側）
- [ ] 1.2 `selectItemsToPurchase` のテストを未購入だけに直してから実装する（「同じ名前の購入済みの商品の購入日時は変えない」の domain 側）
- [ ] 1.3 `selectItemsToDeleteWithList` のテストを書いてから実装する（名前・スコープ・未削除・未購入）

## 2. サーバーの完了

- [ ] 2.1 tRPC の完了のテストを先に直す・足す（「チェック済みの商品と同じ名前の商品を購入済みにする」「同じ名前の購入済みの商品の購入日時は変えない」「tRPC にチェック 0 件の完了が届くと断る」）。179 の「同じ名前の購入済みの商品も購入日時を完了の時刻にする」「チェック 0 件のリストも完了でき空の購入履歴になる」のテストは消す（MODIFIED で Requirement から外れる）。テストが通ることを確かめる
- [ ] 2.2 sync.push の完了のテストを先に足す（「同期で届いたチェック 0 件の完了は conflict にする」、`sync-push.db.test.ts` の「同じ名前の購入済みの商品の購入日時は変えない」）。reason の対応を実装し、`npm run test:db` が通ることを確かめる

## 3. 削除の指定

- [ ] 3.1 `deleteListSchema` の `deleteCatalogItems` と、tRPC の `deleteList` のテストを先に書き（「指定するとリストと同じ名前の未購入の商品を論理削除する」「ほかのスコープ・購入済み・削除済みの同じ名前の商品は消さない」「指定しないとリストだけを消す」「使えないリストは商品ごと消せない」「途中で失敗したら何も消さない」）、`ShoppingSyncService` に実装する。実 DB が要るものは `*.db.test.ts` に置く
- [ ] 3.2 ゲストの `useListMutations.deleteList` の指定のテストを先に書き（「ゲストでは同じ groupId の未購入の商品を消す」と、ダイアログの 2 つの Scenario のゲスト側）、`selectItemsToDeleteWithList` と Dexie の 1 つのトランザクションで実装する

## 4. 画面

- [ ] 4.1 `app/lists/detail/page.tsx` のダイアログを実装し、E2E（`e2e/shopping.spec.ts`）に「チェック 0 件で完了を押すと確認ダイアログを出す」「リストの商品ごと消すとリストと同じ名前の未購入の商品を削除する」「リストだけ消すとカタログの商品は変えずに買いたいものに戻る」「キャンセルするとリストはそのまま」をゲストで、`e2e/auth/` にログイン中の「リストの商品ごと消す…」を足す。「完了に失敗したら画面にエラーを出す」は、`finishShopping` が失敗するようにした画面のテスト（`src/app/lists/detail/__tests__/`）で確かめる。文言はユーザーの確認の結果に合わせる

## 5. 確認

- [ ] 5.1 `npm run lint`・`npm run test:run`・`npm run test:coverage`（80% 以上）・`npm run build` が通る
- [ ] 5.2 `npm run test:db` が通る
- [ ] 5.3 `npm run test:e2e:local` を全部流し、プロジェクトごとの件数を tester の報告に書く

## Workflow follow-up

- tester の結果と reviewer の LGTM がそろったら、`.claude/rules/feature-design.md` の「archive の手順」で archive してコミットする（タスクにしない）。`179-shopping-domain-rules` の archive の後に行う
