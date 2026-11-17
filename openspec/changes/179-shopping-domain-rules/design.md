# Design: 買い物の規則を共用のドメイン関数にまとめる

## Context

動機は proposal.md の Why。今の実装の食い違いは `docs/design-doc.md` の 7.1。この change で関わる今の流れ:

- tRPC の完了: `routers/shopping.ts` の `finishShopping` → `ShoppingService.finishShopping`。リストの商品はトランザクションの外で読み、`catalogItemScope.markScopedItemsPurchasedByName` で名前ごとに UPDATE（購入済みの行も上書き）
- tRPC の取り消し: `routers/shopping.ts` の `revertHistory` に本体があり、トランザクションなし。前提の確認なし
- sync.push: `SyncPushService.finishShopping` / `revertHistory`。1 トランザクション、リストの行はロック済み、操作の時刻（opTime）で LWW
- スナップショット: `routers/shopping.ts` の 4 か所（createList の itemIds・tagIds、addItemToList、addNewItemToList）
- 除外: `routers/catalog.ts` の `getItems`（進行中・未削除のリストの、未削除の商品の名前を SQL で読み、名前で除く）
- 画面: `app/lists/detail/page.tsx` の完了ボタンはチェック 0 件で押せない

## Goals / Non-Goals

**Goals:**
- 規則を `src/modules/shopping/domain/services/` の純粋関数に 1 つだけ置き、サーバーの tRPC と sync.push が同じ関数を通る
- 照合を「SQL の UPDATE の WHERE」から「候補を読む → domain で選ぶ → id で書く」に変え、規則が SQL に埋もれないようにする
- チェック 0 件の完了をユーザーの決定どおりにする（3 つのモード）

**Non-Goals:**
- クライアントの hooks の置き換え、router を薄くすること、ポートの導入（proposal.md の Non-goals）
- `catalogItemScope.ts` の削除（`deleteHistory` が使う `deleteScopedItemsByName` は残す）

## Decisions

### D1. 食い違っている規則と、正にするもの

| 規則 | tRPC | sync.push | ゲスト | 正にするもの | 理由 |
|------|------|-----------|--------|------------|------|
| 完了: チェック 0 件 | 空の履歴を作る | 空の履歴を作る | 例外 | ダイアログで削除方法を選ぶ。サーバーは断る（tRPC: BAD_REQUEST、sync.push: conflict `no_checked_items`） | ユーザーの決定（2026-11-17）。サーバーで勝手に消さない（確認事項 4） |
| 完了: 状態の確認 | `isInProgress` / `canTransition` | status と LWW（`stale`） | しない | 進行中であること（domain）。LWW は sync の層に残す | 状態の規則は domain、時刻の比較は同期の都合 |
| 完了: カタログの照合 | 名前・スコープ・未削除。購入済みも上書き | 名前・スコープ・未削除・LWW。購入済みも上書き | 名前・未購入（スコープなし） | 名前・スコープ・未削除・**未購入**（sync.push は LWW も） | 前の購入の記録を書き換えない（確認事項 5）。スコープは他人のデータを触らないため必須 |
| 完了: 未チェックの商品 | 論理削除 | 論理削除 | 物理削除 | リストから外す（サーバーは論理削除。消し方は infrastructure） | 規則は「外す」だけ。消し方は保存先の都合 |
| 完了: リストの商品を読む時点 | トランザクションの外 | 中（リストをロック） | — | トランザクションの中で、リストの行をロックしてから読む | 読んだ後のチェックの変更を取りこぼさない |
| 取り消し: 前提 | なし | 購入日時あり | 購入日時あり | 購入日時が入っていること（domain） | 「購入日時の入ったリスト」が履歴の定義（design-doc 3） |
| 取り消し: カタログの照合 | 名前・スコープ・未削除・購入済み | 同じ + LWW | 名前・購入済み（スコープなし） | 名前・スコープ・未削除・購入済み（sync.push は LWW も） | 今のサーバーのまま（「この履歴で買った分だけ」は Non-goals） |
| 取り消し: トランザクション | なし | 1 つ | — | 1 つ | 一部だけ反映されるのを防ぐ |
| スナップショットの groupId | リストの groupId | —（クライアントの行をそのまま受ける） | item とリストが混在 | リストの groupId | リストの中で groupId がそろう。サーバーが今そうしている |
| 除外の範囲 | 進行中・未削除のリストの未削除の商品。グループはその groupId、個人は groupId なし・自分 | — | 進行中のリストを groupId だけで | サーバーのまま | 個人のスコープを userId で絞らないと、他人の個人のリストが混ざる |
| 0 件の完了の「商品ごと消す」の照合 | （新規） | — | （新規） | 名前・スコープ・未削除・未購入 | 確認事項 2 |

### D2. domain の関数（`src/modules/shopping/domain/services/`）

Drizzle・Dexie・tRPC・`@/infrastructure` を import しない。入力は domain で定義する最小の型（行の型を受けない）で、時刻は引数で受ける（`new Date()` を中で呼ばない）。

| ファイル | 関数 | 入力 → 出力 |
|---------|------|-----------|
| `finishShopping.ts` | `planFinishShopping` | リストの状態・リストの商品（id・名前・チェック）・時刻・場所 → `{ ok: true, listState, purchaseNames, removeEntryIds }` か `{ ok: false, reason: "not_in_progress" \| "no_checked_items" }` |
| `revertHistory.ts` | `planRevertHistory` | リストの購入日時・リストの商品の名前 → `{ ok: true, listState, revertNames }` か `{ ok: false, reason: "not_completed" }` |
| `catalogMatch.ts` | `selectItemsToPurchase` / `selectItemsToUnpurchase` / `selectItemsToDeleteWithList` | 名前の一覧・カタログの候補（id・名前・所有スコープ・購入日時・削除済みか）・リストのスコープ → 一致した商品の id |
| `snapshot.ts` | `snapshotListItem` | カタログの商品（名前・数量・メモ・タグの id）・リスト（id・groupId）・新しい id → リストの商品の作成入力（未チェック） |
| `activeListExclusion.ts` | `excludeItemsInActiveLists` | カタログの商品・進行中のリストの商品の名前 → 一覧に出す商品 |

- 理由の値（`not_in_progress` など）は、sync.push の conflict の reason と対応させる（`not_in_progress` → 今の `already_completed` を変えない。reason の文字列は sync の層で決める）
- 除外の「どのリストが進行中で同じスコープか」はサーバーでは SQL の条件のまま残し、名前での除外だけ domain を使う。クライアントで使うとき（O8）は同じ条件の述語を domain に足す
- 所有スコープの判定 `isSameScope` と型 `OwnerScope` は `src/infrastructure/db/ownership.ts` から `src/shared/domain/ownerScope.ts` に移し、ownership.ts は再エクスポートする（定義は 1 つのまま。#101）。domain は shared だけを import する

代替案: 照合を SQL の WHERE に残し、domain は「名前の一覧」だけを返す。→ 未購入・スコープの規則が SQL とクライアントのフィルタに分かれたままになり、O8 でまたずれるので採らない。

### D3. サーバーの組み立て（application 層）

- 完了・取り消しの I/O の手順を `src/modules/shopping/application/services/` の関数（例: `applyFinishShopping(tx, listRow, at, opTime?)`）にまとめ、tRPC（`ShoppingService`）と sync.push（`SyncPushService`）の両方から呼ぶ。手順: リストの行をロック → リストの商品を読む → `plan*` → 候補を `name IN (...)` とスコープ・未削除で 1 回で読む → `select*` で選ぶ → id の一覧で 1 回で UPDATE（sync.push は `fieldNotNewerThan` を WHERE に足す）→ 外す商品を論理削除 → リストを更新
- 名前ごとの UPDATE（N+1）が、候補の SELECT 1 回と UPDATE 1 回になる
- tRPC の取り消しは `ShoppingService.revertHistory` に移し、1 トランザクションにする。同期の記録（`sync_operations`）は今と同じくコミットの後に書く
- 0 件の削除: `deleteListSchema` に `deleteCatalogItems?: boolean` を足す。true なら、`ShoppingSyncService.deleteHistory` と同じ形で、1 トランザクションの中で候補を読み `selectItemsToDeleteWithList` で選んで論理削除（item_tags も消す）し、リストを論理削除する
- 依存の向き: router（infrastructure）→ application → domain、application → shared。sync の application が shopping の application を呼ぶのは今と同じ（7.5 の解消は Non-goals）。catalog の router が shopping の domain（除外）を使うのは、「買いたいもの」の一覧が shopping の状態に依存する読み取りのため。catalog の domain・application は shopping に依存しない

### D4. クライアント（画面と、ゲストの `deleteList` だけ）

- `app/lists/detail/page.tsx`: チェック 0 件のとき、完了ボタンを押せるようにし、押すと BottomSheet のダイアログを出す。選んだ方法で `deleteList(listId, { deleteCatalogItems })` を呼び、`/lists` に移る。`finishShopping` は呼ばない
- `useListMutations.deleteList`: サーバーのときは tRPC にそのまま渡す。ゲストのときは、同じ名前・同じ groupId・未購入の商品を `selectItemsToDeleteWithList` で選んで消す（ゲストの商品は userId を持たないので、リストと商品の両方に同じ固定の所有者を入れたスコープを渡す）
- ゲストの `finishShopping` の 0 件の例外は残す（画面から 0 件で呼ばれなくなる）

### D5. DB

スキーマ・migration・Dexie の version の変更はない。リリース手順への影響もない。

## Risks / Trade-offs

- [照合を「読んでから書く」にすると、読んだ後に別の処理が同じ商品を変えうる] → トランザクションの中でリストの行をロックしてから読む。カタログの商品の購入日時は、tRPC は後勝ち、sync.push は LWW の条件を UPDATE に残すので、今より悪くならない
- [完了の照合を未購入に限ると、前に購入済みの同じ名前の商品は「最後に買った日」が更新されなくなる] → 確認事項 5 でユーザーに確かめる。購入済みの一覧の並びが変わりうることを伝える
- [`no_checked_items` の conflict を受けたクライアント] → 今の SyncEngine は conflict をすべて「サーバーの行で戻す + トースト」で扱うので、追加の対応はいらない。ローカルファーストの画面はまだ sync.push の完了を送らない
- [ゲストの「商品ごと消す」だけ domain を使い、ほかの hooks は古いまま] → O7/O8 で置き換える。それまでの間、ゲストの完了の照合（名前・未購入・スコープなし）はサーバーとずれたまま（今と同じ）

## Migration Plan

DB の変更がないので、通常の develop へのマージで出す。戻すときは revert でよい（API の追加項目は省略可なので、古い画面からの呼び出しも通る）。
