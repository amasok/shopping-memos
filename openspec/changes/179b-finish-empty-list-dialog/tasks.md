# Tasks

ユーザーの承認（2026-11-18）が済み、`179-shopping-domain-rules`・O7・O8 は archive 済み。各タスクは RED → GREEN → REFACTOR の順。かっこ内は、そのタスクでテストを書く specs の Scenario。

## 1. domain の変更

- [ ] 1.1 `planFinishShopping` のテストに `no_checked_items` を足してから実装する（「tRPC にチェック 0 件の完了が届くと断る」の domain 側）
- [ ] 1.2 `selectItemsToPurchase` のテストを未購入だけに直してから実装する（「同じ名前の購入済みの商品の購入日時は変えない」の domain 側）
- [ ] 1.3 `selectItemsToDeleteWithList` のテストを書いてから実装する（名前・スコープ・未削除・未購入）

## 2. サーバーの完了

- [ ] 2.1 tRPC の完了（`ShoppingService`）のテストを先に直す・足す（`src/modules/shopping/__tests__/finishShopping*.test.ts`・`shopping-completion.db.test.ts`。「チェック済みの商品と同じ名前の商品を購入済みにする」「同じ名前の購入済みの商品の購入日時は変えない」「tRPC にチェック 0 件の完了が届くと断る」）。179 の「同じ名前の購入済みの商品も購入日時を完了の時刻にする」「チェック 0 件のリストも完了でき空の購入履歴になる」のテストは消す（ほかのテストは名前を「チェック済みの商品がある買い物の完了」の Scenario に合わせる）
- [ ] 2.2 sync.push の完了のテストを先に足す（`syncPushService.test.ts`・`sync-push.db.test.ts` に「同期で届いたチェック 0 件の完了は conflict にする」「同じ名前の購入済みの商品の購入日時は変えない」）。reason の対応を実装し、`npm run test:db` が通ることを確かめる

## 3. 削除の指定

- [ ] 3.1 `deleteListSchema` の `deleteCatalogItems` と、tRPC の `deleteList` のテストを先に書き（「指定するとリストと同じ名前の未購入の商品を論理削除する」「ほかのスコープ・購入済み・削除済みの同じ名前の商品は消さない」「指定しないとリストだけを消す」「使えないリストは商品ごと消せない」「途中で失敗したら何も消さない」）、`ShoppingSyncService`・`catalogItemScope.ts` に実装する。実 DB が要るものは `*.db.test.ts` に置く。`getList` の入力は id だけのスキーマに分ける
- [ ] 3.2 端末の DB の `shoppingRepository.deleteList` の指定のテストを先に書き（`shoppingRepository.test.ts` に「ゲストでは同じ groupId の未購入の商品を消す」「ローカルファーストでは端末の DB で消してキューに削除を積む」）、`selectItemsToDeleteWithList` で実装する。`useListMutations.deleteList` に指定を通す

## 4. 端末の DB の完了

- [ ] 4.1 `shoppingRepository.test.ts`・`catalogLocalFirst.test.tsx` の完了のテストを先に直す（「ローカルファーストの完了は端末の DB を更新し複合操作を 1 つ積む」「ローカルファーストの完了は同じ名前の購入済みの商品の購入日時を変えない」「ローカルファーストではチェック 0 件で完了するとエラーになる」「完了済みのリストは端末の DB でも完了できない」）。O8 の「…購入済みの商品も更新する」「…チェック 0 件でも完了できる」のテストは消す。`FinishRules` をなくし、ゲストとローカルファーストを同じ規則にする

## 5. 画面

- [ ] 5.1 `app/lists/detail/page.tsx` のダイアログを実装し、E2E（`e2e/shopping.spec.ts`）に「チェック 0 件で完了を押すと確認ダイアログを出す」「リストの商品ごと消すとリストと同じ名前の未購入の商品を削除する」「リストだけ消すとカタログの商品は変えずに買いたいものに戻る」「キャンセルするとリストはそのまま」をゲストで、`e2e/auth/` にログイン中の「リストの商品ごと消す…」を足す
- [ ] 5.2 「完了に失敗したら画面にエラーを出す」を、`finishShopping` が失敗するようにした画面のテスト（`src/app/lists/detail/__tests__/`）で確かめる

## 6. 確認

- [ ] 6.1 `npm run lint`・`npm run test:run`・`npm run test:coverage`（80% 以上）・`npm run build` が通る
- [ ] 6.2 `npm run test:db` が通る
- [ ] 6.3 `npm run test:e2e:local` を全部流し、プロジェクトごとの件数を tester の報告に書く

## Workflow follow-up

- tester の結果と reviewer の LGTM がそろったら、`.claude/rules/feature-design.md` の「archive の手順」で archive してコミットする（タスクにしない）。62-o8b も `openspec/specs/shopping` を変えるので、先に archive された方を消さないよう順番を調整する
