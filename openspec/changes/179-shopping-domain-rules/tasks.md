# Tasks

各タスクは RED（テストを書いて失敗を確かめる）→ GREEN → REFACTOR の順に進める。かっこ内は、そのタスクでテストを書く specs の Scenario。見える結果を変えない change なので、既存のテストは通ったままにする（直すのは、import の経路などテストの書き方だけ）。

## 1. 共有カーネルの所有スコープと import の制限

- [ ] 1.1 `src/shared/domain/__tests__/ownerScope.test.ts` に `isSameScope` のテストを書き（「グループのリストは同じグループの商品とだけ一致する」「個人のリストは作成者の個人の商品とだけ一致する」「所有者がわからない個人のリストはどの商品とも一致しない」）、`isSameScope` と `OwnerScope` を `src/shared/domain/ownerScope.ts` に移す。`ownership.ts` からは再エクスポートせず、使っている箇所の import を shared に変える。ownership.ts のコメント（「src/shared には置かない」）を直す。既存の ownership のテストが通ることを確かめる
- [ ] 1.2 `eslint.config.mjs` に、`isSameScope`・`OwnerScope` を `@/infrastructure/db/ownership` から import しない制限と、`src/modules/*/domain/**`（`domain/repositories/**` を除く）から `drizzle-orm`・`dexie`・`@trpc/*`・`@/infrastructure/*` を import しない制限を足し、`npm run lint` が通ること、わざと違反した import で lint が失敗することを確かめる

## 2. domain の純粋関数（`src/modules/shopping/domain/services/`）

- [ ] 2.1 `catalogMatch.ts` のテストを書いてから実装する（「論理削除された商品は照合しない」、購入済みにするほうは購入状態を見ず、未購入に戻すほうは購入済みだけを選ぶ）
- [ ] 2.2 `finishShopping.ts`（`planFinishShopping`）のテストを書いてから実装する（進行中でないと `not_in_progress`、チェック済みの名前と外す商品の id、全部チェック済みなら外す商品は 0 件、チェック 0 件でも完了の計画になる、リストの状態に時刻と場所が入る）
- [ ] 2.3 `revertHistory.ts`（`planRevertHistory`・`canRevert`）のテストを書いてから実装する（購入日時がないと `not_completed`、戻した状態は進行中で日時・場所が null）
- [ ] 2.4 `snapshot.ts`（`snapshotListItem`）のテストを書いてから実装する（「カタログの商品の名前・数量・メモ・タグを写す」「リストの商品の groupId はリストの groupId にする」）
- [ ] 2.5 `activeListExclusion.ts`（`excludeItemsInActiveLists`）のテストを書いてから実装する（名前が一致する商品だけ除く）

## 3. サーバーの完了（tRPC と sync.push）

- [ ] 3.1 tRPC の完了のテストを先に足す（「チェック済みの商品と同じ名前の商品を購入済みにする」「同じ名前の購入済みの商品も購入日時を完了の時刻にする」「チェック 0 件のリストも完了でき空の購入履歴になる」「未チェックの商品をリストから外す」「全部チェック済みならリストの商品はすべて残る」「完了したリストに購入日時と場所が入る」「完了済みのリストは完了できない」「使えないリストや削除したリストは tRPC で完了できない」「確認の後に使えなくなったリストは完了しない」）。`sync_operations` に記録する item の id が、購入済み・別スコープ・削除済みを混ぜても今と同じ集合になることも確かめる。実 DB が要るものは `*.db.test.ts` に置く
- [ ] 3.2 完了の I/O の手順を application の関数にまとめ（D3）、`ShoppingService.finishShopping` をそれに置き換える。ロックの SELECT とリストの UPDATE に `notDeleted`・`accessibleByUser` を付ける。3.1 のテストと既存の完了のテストが通ることを確かめる
- [ ] 3.3 sync.push の完了のテストを先に足す（「同期で届いた完了済みのリストの完了は conflict にする」「同期で届いた使えないリストの完了は rejected にする」「同期で届いた削除したリストの完了は conflict にする」「同期で届いた古い完了は conflict にする」「同期で届いた完了は操作の時刻より新しい購入日時を上書きしない」、sync.push 側の「チェック 0 件のリストも完了でき空の購入履歴になる」）。既にあるテストで足りるものは、Scenario 名をテスト名に合わせる
- [ ] 3.4 `SyncPushService.finishShopping` を 3.2 の関数に置き換え、3.3 のテストと `npm run test:db` が通ることを確かめる

## 4. サーバーの取り消し

- [ ] 4.1 取り消しのテストを先に書く（「リストの商品と同じ名前の購入済みの商品を未購入に戻す」「取り消したリストは進行中に戻る」「購入履歴でないリストは取り消せない」「使えないリストや削除したリストは tRPC で取り消せない」「取り消しの途中で失敗したら何も反映しない」、sync.push の「同期で届いた購入履歴でないリストの取り消しは conflict にする」「同期で届いた使えないリストの取り消しは rejected にする」「同期で届いた削除したリストの取り消しは conflict にする」「同期で届いた古い取り消しは conflict にする」）。記録する item の id が今と同じ集合になることも確かめる
- [ ] 4.2 `routers/shopping.ts` の `revertHistory` の本体を `ShoppingService.revertHistory`（1 トランザクション。ロックの SELECT に `notDeleted`・`accessibleByUser`）に移し、`SyncPushService.revertHistory` と同じ application の関数を使う。4.1 のテストと `npm run test:db` が通ることを確かめる

## 5. スナップショットと除外のサーバーの置き換え

- [ ] 5.1 `routers/shopping.ts` のスナップショットの 4 か所を `snapshotListItem` に置き換え、既存の router のテストが通ることを確かめる
- [ ] 5.2 `routers/catalog.ts` の `getItems` の除外のテストを足し（「進行中のリストにある商品と同じ名前の商品は一覧に出ない」「完了したリストや削除したリストの商品は除かない」「リストから外した商品は除かない」「ほかのスコープの進行中のリストの商品は除かない」「ほかのユーザーの個人の進行中のリストの商品は除かない」）、名前での除外を `excludeItemsInActiveLists` に置き換える

## 6. 確認

- [ ] 6.1 `npm run lint`・`npm run test:run`・`npm run test:coverage`（80% 以上）・`npm run build` が通る
- [ ] 6.2 `npm run test:db` が通る
- [ ] 6.3 `npm run test:e2e:local` を全部流し、プロジェクトごとの件数を tester の報告に書く

## Workflow follow-up

- tester の結果と reviewer の LGTM がそろったら、`.claude/rules/feature-design.md` の「archive の手順」で archive してコミットする（タスクにしない）
