# Design: 買い物をローカルファーストに移す（#62 O8）

## Context

動機は proposal.md の Why。O7 までにあるもの: `useCatalogSource`（guest / server / local の経路と `LocalStore`）、`infrastructure/local/repository.ts`（`createRecord` / `updateRecord` / `deleteRecord`）、`catalogRepository.ts`、キューの圧縮（`syncQueue.ts` の `planEnqueue`。複合操作はまとめずに後ろに積む）、#179 の domain の関数（`planFinishShopping`・`planRevertHistory`・`selectItemsToPurchase` / `selectItemsToUnpurchase`・`snapshotListItem`）。sync.push は、リストの `create`（name・groupId）・`update`（name）・`delete`、リストの商品の `create`（listId・name・quantity・memo・tagIds・checked）・`update`（checked）・`delete`、複合操作 `finishShopping`（location）・`revertHistory` を受け付ける（`pushPatches.ts`）。

## Goals / Non-Goals

**Goals:**
- 買い物の hooks を O7 と同じ経路にし、端末の DB の書き込みを `LocalShoppingRepository` に集める。ゲストの hooks のコピーをなくし、規則は domain の関数を通す
- ローカルファーストの見え方と結果をサーバーファーストと同じにする（フラグを切り替えても同じ）
- ゲストの見える結果は変えない

**Non-Goals:** proposal.md の Non-goals

## Decisions

### D1. 経路

- O7 の `useCatalogSource()` をそのまま使う（名前はカタログだが、端末の DB の経路そのもの。改名は O11 でフラグを消すときにまとめる）。`useDataSource()` は買い物の hooks から使わなくなる（グループの詳細の `useGroup` が残る）
- 書き込みの後は `afterWrite()`（local なら `requestSync()`）。`refreshCatalog()` は server の invalidate だけにする（local の `engine.sync()` をやめる。catalog の REMOVED / ADDED）

### D2. `LocalShoppingRepository`（`src/infrastructure/local/shoppingRepository.ts`）

| 操作 | 端末の DB | キュー |
|------|----------|-------|
| `createList({ name, groupId, itemIds, tagIds })` | リストと、選んだ商品・タグ（同じ groupId・未購入・タグの OR）の商品のスナップショット | リストの `create`、リストの商品の `create` |
| `updateList({ id, name })` | 名前 | `update {name}` |
| `deleteList(id)` | リストの商品とリスト | 進行中のリストなら、リストの商品ごとの `delete`、リストの `delete`（この順）。完了したリストなら、リストの `delete` だけ |
| `addItemToList({ listId, itemId })` | スナップショット | リストの商品の `create` |
| `addNewItemToList({ listId, name, quantity, memo, tagIds })` | カタログの商品（リストの groupId）とスナップショット | 商品の `create`（catalogRepository）、リストの商品の `create` |
| `removeItemFromList(id)` | リストの商品 | `delete` |
| `checkItem(id, checked)` | checked | `update {checked}` |
| `finishShopping(listId, location, rules)` | D3 | `finishShopping {location}` だけ |
| `revertHistory(listId)` | D3 | `revertHistory` だけ |
| `deleteHistory(listId)` | リストの商品・リスト・同じ名前と groupId のカタログの商品（購入日時が入っていなければ「履歴が見つかりません」のエラー。サーバーの `getHistoryById` の NOT_FOUND と同じ） | カタログの商品ごとの `delete`、リストの `delete`（リストの商品の `delete` は積まない） |

- すべて 1 つのトランザクション（`lists`・`listItems`・`items`・`syncQueue`）。Dexie は、内側のトランザクション（`createRecord` など）が外側のテーブルの一部なら外側を使う
- 進行中のリストを消すとき、リストの商品の `delete` も積む: 送る前のリストの商品の `create` が圧縮で一緒に消える（積まないと、送る前のリストの create + delete が消えた後に、リストの商品の create だけが残り、サーバーで `not_found` になる）。送信済みなら、リストの商品の `delete` はリストの `delete` より先に届き、リストが進行中なので `removeItem` で applied になる
- 完了したリスト（履歴の削除と、完了したリストの削除）では、リストの商品の `delete` を積まない。サーバーは完了したリストの商品の削除を `list_completed` で断る（`SyncPushService.delete`）ので、failed が残り続けるため。リストの `delete` がリストの商品もまとめて論理削除する。完了したリストの商品の `create` は完了より前に積まれていて先に送られるので、取り残しはない
- 完了したリストへの追加・外す・チェックは、リポジトリが断る（sync.push の `list_completed` と同じ。画面からはできない）
- 商品・タグの参照: `createList` の `itemIds` は、端末の DB にない商品を飛ばし、リストと違う groupId の商品があればエラーにする（サーバーの `createList` の `continue` と FORBIDDEN と同じ）。`addItemToList` の商品は、なければ「アイテムが見つかりません」、groupId が違えばエラー。未購入の絞り込みはタグで選ぶときだけで、`itemIds` には掛けない（サーバーと同じ）

### D3. 完了と取り消し（domain の関数を端末の DB に当てる）

- 手順（完了）: リストを読む → リストの商品を読む → `planFinishShopping` → 候補（同じ groupId のカタログの商品）を読む → `selectItemsToPurchase` → 選んだ商品の `purchasedAt` を時刻にする（キューには積まない）→ 外す商品を消す（キューには積まない）→ リストの状態を書く → `finishShopping` を積む
- 取り消しも同じ形（`planRevertHistory` → `selectItemsToUnpurchase`）
- 端末の DB の照合のスコープ: ユーザー DB にはサーバーが返した自分のスコープの行だけがあり、ゲスト DB はゲストのものだけなので、スコープは groupId が同じことと同じになる。ローカルで作った商品は userId を持たないので、domain の `isSameScope` には、候補とリストの両方に同じ固定の所有者（`"local"`）を入れて渡す
- 時刻は `store.clock.now()`。sync.push は操作の時刻（clientTime）で同じ時刻を書くので、端末とサーバーの購入日時がそろう
- カタログの商品・リストの商品の変更をキューに積まない理由: サーバーの `finishShopping` が同じ規則で 1 トランザクションで行う。積むと二重になり、LWW の時刻も操作ごとにずれる。push は pull より先に走り、pull は未送信の操作がある行（リスト）を上書きしない
- ゲストの規則（D4）は `rules: "guest"` で分ける

### D4. ゲストで残す振る舞い（179b と重なるもの）

| 振る舞い | サーバー・ローカルファースト | ゲスト（O8 で残す） | 扱い |
|---------|--------------------------|------------------|------|
| チェック 0 件の完了 | 完了できる（空の履歴） | エラー「購入済みのアイテムがありません」 | 179b で決める |
| 完了の照合 | 同じ名前の購入済みも更新 | 未購入だけ | 179b の確認事項 5 で決める |
| リスト・リストの商品の並び | 作成日時の古い順 | 並べ替えない | `62-o8b-shopping-guest-order` で決める |
| 取り消し・削除の照合のスコープ | groupId | 名前だけ（ゲストにはグループがないので、結果は同じ） | そろえる（見える変化なし） |
| スナップショットの groupId | リスト | 商品とリストが混在（ゲストにはグループがないので、どちらも undefined） | そろえる（見える変化なし） |
| 完了したリストへの追加など | 断る | 確かめない（画面からはできない） | そろえる（見える変化なし） |

### D5. 読み取り（`src/hooks/data/shoppingQueries.ts`）

- `queryLists(db, { groupId, status, includeCompleted, includeAllGroups, order })`、`queryListItems(db, listIds, order)`、`queryHistory(db, { groupId, limit, offset })`。O7 の `catalogQueries` と同じく fake-indexeddb でテストする
- 並び: local はサーバーと同じ（リスト・リストの商品は `createdAt` の昇順、履歴は `purchasedAt` の降順）、guest は今のまま（リスト・リストの商品は並べ替えない、履歴は `purchasedAt` の降順）
- `useList` の local はリストとリストの商品をユーザー DB から読む。サーバーの `getList` の `items` の `tags`（名前）は、画面で使っていないので作らない
- 初回の同期の前（`awaitingFirstSync`）は読み込み中

### D6. 依存の向き

hooks → `infrastructure/local/shoppingRepository` → `repository.ts`・`catalogRepository.ts`・`lib/db`。`shoppingRepository` → `modules/shopping/domain/services`（純粋関数）。domain は何も import しない（eslint の制限のまま）。

### D7. DB

サーバーの DB・API、Dexie の version の変更はない。

## Risks / Trade-offs

- [`finishShopping` / `revertHistory` がサーバーで conflict（ほかの端末で先に完了・取り消し）か rejected（`invalid_patch` など）になると、端末で変えたカタログの商品が戻らない] → SyncEngine は conflict のリストの行だけを戻す。商品はサーバーで変わっていなければ次の差分に来ないので、全件の取り直しまでずれが残る。まれ（同じリストを 2 台で同時に完了する）なので受け入れ、O9 の失敗した操作の表示で見直す
- [ローカルファーストの完了で、送る前にチェックを外した操作と完了の順番] → キューは積んだ順に送るので、サーバーでもチェックの変更の後に完了が当たる
- [ゲストだけ規則が違う部分が残る] → D4 の表。179b と 62-o8b の決定で消す
- [端末の DB の履歴の削除は、端末にあるカタログの商品だけを消す] → 前回の pull の後にほかの端末で作られた同じ名前の商品は、tRPC の `deleteHistory`（サーバーで名前で消す）と違って消えない。次の pull で一覧に出るので、利用者が消せる

## Migration Plan

本番はフラグが false のままなので、マージしても見える振る舞いは変わらない。R3 で O9 とまとめて、環境変数で有効にする。戻すときは revert でよい。
