# Tasks

各タスクは RED → GREEN → REFACTOR の順。かっこ内は、そのタスクでテストを書く specs の Scenario（shopping / catalog）。端末の DB のテストは fake-indexeddb で行う。

## 1. リポジトリ

- [ ] 1.1 `src/infrastructure/local/__tests__/shoppingRepository.test.ts` に、リストと商品の書き込みのテストを先に書き（shopping「カタログの商品を選んでリストを作るとスナップショットが入る」「タグを選んでリストを作ると同じグループの未購入のタグ付きの商品が入る」「新しい商品をリストに入れるとカタログにも作る」「商品をチェックするとチェックだけをキューに積む」「リストから商品を外すとキューに削除を積む」「進行中のリストを消すとリストの商品も消しキューに削除を積む」「送る前に作ったリストを消すとキューに何も残らない」「完了したリストには商品を入れられない」）、`shoppingRepository.ts` を実装する。キューのパッチが `pushPatches.ts` の検証を通ることも確かめる
- [ ] 1.2 完了・取り消し・削除のテストを先に書き（shopping「ローカルファーストの完了は端末の DB を更新し複合操作を 1 つ積む」「ローカルファーストの完了は同じ名前の購入済みの商品も更新する」「ローカルファーストではチェック 0 件でも完了できる」「完了済みのリストは端末の DB でも完了できない」「ローカルファーストの取り消しは端末の DB を戻し複合操作を 1 つ積む」「購入履歴でないリストは端末の DB でも取り消せない」「履歴を削除すると同じ名前のカタログの商品も消す」「購入履歴でないリストは履歴として削除できない」「ゲストはチェック 0 件で完了するとエラーになる」「ゲストの完了は同じ名前の未購入の商品だけを購入済みにする」）、実装する。ゲスト（queue: false）の取り消し・履歴の削除・リストへの追加・リストの削除も、今と同じ結果（名前での照合・端末からの削除・キューは空）になることをユニットテストで確かめる

## 2. 読み取りと hooks

- [ ] 2.1 `shoppingQueries.ts` のテストを先に書き（shopping「進行中のリストだけを選んでいるグループから出す」「ローカルファーストのリストとリストの商品は作成日時の古い順」「履歴は購入日時の新しい順にリストの商品つきで出す」）、実装する
- [ ] 2.2 `useLists` / `useListsWithItems` / `useList` / `useHistory` を経路で切り替え、hooks の単位のテストを先に書く（shopping「ローカルファーストで初回の同期の前は買い物の一覧も読み込み中」）。フラグが false の分岐（tRPC）は変えない
- [ ] 2.3 `useListMutations` / `useHistoryMutations` の端末側をリポジトリに置き換え、hooks のテストを先に書く（shopping「フラグが true ならリストの作成はユーザー DB に書きキューに積む」「フラグが false ならリストの作成はサーバーに送る」「ゲストのリストの作成はゲスト DB に書きキューに積まない」）。ゲストのコピー（完了・取り消し・削除・スナップショット）を消す
- [ ] 2.4 `refreshCatalog()` を server の invalidate だけにし、O7 の「ローカルファーストでリストに商品を入れると同期する」のテストを、catalog「サーバーファーストではカタログのキャッシュを無効にする」「ローカルファーストではリストに入れた商品が一覧からすぐに消える」に置き換える

## 3. 文書

- [ ] 3.1 `docs/features/offline-support.md` の O8 の行と「O8 での細部」を書く

## 4. 確認

- [ ] 4.1 `npm run lint`・`npm run test:run`・`npm run test:coverage`（80% 以上）・`npm run build` が通る
- [ ] 4.2 `npm run test:e2e:local` を全部流し、プロジェクトごとの件数を tester の報告に書く（フラグは false。ゲストの経路が変わるので、shopping・list-creation・history・user-journey とオフラインのリストの E2E が大事）

## Workflow follow-up

- tester の結果と reviewer の LGTM がそろったら、`.claude/rules/feature-design.md` の「archive の手順」で archive してコミットする（タスクにしない）
