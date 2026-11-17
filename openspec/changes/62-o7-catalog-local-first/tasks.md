# Tasks

各タスクは RED → GREEN → REFACTOR の順。かっこ内は、そのタスクでテストを書く specs の Scenario（catalog / sync）。端末の DB のテストは fake-indexeddb で行う。

## 1. リポジトリ

- [ ] 1.1 `src/infrastructure/local/__tests__/catalogRepository.test.ts` を先に書き（catalog「商品を作ると行とキューの作成の操作が書かれる」「商品を変えると変えたフィールドだけがキューに積まれる」「商品を消すとキューに削除の操作が積まれる」「タグを作る・名前を変えるとキューに積まれる」「タグを消すと商品のタグからも外し、商品の更新もキューに積む」「送る前に作ったタグを消すと商品の作成のパッチからも外れる」「商品の更新で送るフィールドは今の tRPC の更新と同じ」「キューに積めなければ行も書かない」「ゲストで商品を変えると更新日時が変わりキューには積まない」「ゲストでタグを消すと商品のタグからも外す」）、`catalogRepository.ts` を実装する。キューのパッチが `pushPatches.ts` の検証を通ることもテストで確かめる

## 2. 経路と読み取り

- [ ] 2.1 `useCatalogSource` のテストを先に書き（catalog「ゲストはゲスト DB を読み書きする」「フラグが false ならログイン中はサーバーを読み書きする」「フラグが true ならログイン中はユーザー DB を読み書きする」の経路の決め方）、実装する
- [ ] 2.2 `catalogQueries.ts`（`queryItems` / `queryTags`）のテストを先に書き（catalog「選んでいるグループの商品だけを出す」「購入済みの商品は指定がなければ出ない」「タグを指定するとどれかのタグが付いた商品だけを出す」「進行中のリストにある商品は一覧に出ない」「ローカルファーストの並びはサーバーと同じ作成日時の古い順」「ローカルファーストのタグは選んでいるグループのものを名前の文字コードの順に出す」）、実装する
- [ ] 2.3 `useItems` / `useTags` を `useCatalogSource` と `catalogQueries` に置き換え、初回の同期の読み込み中を入れる（catalog「初回の同期の前は読み込み中」「初回の同期の後はユーザー DB の一覧を出す」のテストを hooks の単位で先に書く）。フラグが false の分岐（tRPC）は変えない
- [ ] 2.4 `useItemMutations` / `useTagMutations` の端末側をリポジトリに置き換え、`local` では書き込みの後に `requestSync()` を呼ぶ（hooks のテストで、3 つの経路の呼び先を確かめる）。`ItemForm` などの既存のテストが通ることを確かめる

## 3. 買い物の変更の後の同期

- [ ] 3.1 `refreshCatalog()` のテストを先に書き（catalog「ローカルファーストでリストに商品を入れると同期する」「サーバーファーストではカタログのキャッシュを無効にする」）、`useListMutations` / `useHistoryMutations` の `catalog.getItems.invalidate()` を置き換える

## 4. グループのキャッシュ

- [ ] 4.1 `SyncEngine` のテストを先に書き（sync「pull の後に所属グループでキャッシュを上書きする」「グループの一覧の取得に失敗しても同期は終わる」「push だけの同期（drain）ではグループを取りにいかない」）、transport の `getGroups` とキャッシュの上書きを実装する。`SyncContext` から `identity.getGroups` を渡す
- [ ] 4.2 `useGroups` のテストを先に書き（sync「グループの一覧はキャッシュから出す」「グループを作った後に同期して一覧に出す」）、`local` ではキャッシュを読み、`refetch` を同期にする
- [ ] 4.3 `app/groups/page.tsx` のゲスト DB への書き込みをやめ、既存のグループの E2E（`e2e/auth/`）が通ることを確かめる

## 5. 文書

- [ ] 5.1 `docs/features/offline-support.md` を D8 のとおり直し、`docs/design-doc.md` の 7.9 に直した行を書く

## 6. 確認

- [ ] 6.1 `npm run lint`・`npm run test:run`・`npm run test:coverage`（80% 以上）・`npm run build` が通る
- [ ] 6.2 `npm run test:e2e:local` を全部流し、プロジェクトごとの件数を tester の報告に書く（フラグは false。本番の経路が変わらないことの確認）

## Workflow follow-up

- tester の結果と reviewer の LGTM がそろったら、`.claude/rules/feature-design.md` の「archive の手順」で archive してコミットする（タスクにしない）
