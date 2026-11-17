# Design: チェック 0 件の完了でリストの削除を選ばせる

## Context

動機は proposal.md の Why。`179-shopping-domain-rules` で、完了・照合の規則は `src/modules/shopping/domain/services/` の純粋関数（`planFinishShopping`・`catalogMatch.ts`）になり、tRPC と sync.push が同じ関数を通る。ただし振る舞いは今のサーバーのまま（0 件でも完了でき、照合は購入済みも上書き）。この change はその関数を変える。画面（`app/lists/detail/page.tsx`）の完了ボタンは今、チェック 0 件で押せない。

## Goals / Non-Goals

**Goals:**
- チェック 0 件の完了を、ダイアログで削除方法を選ぶ形にし、3 つのモードで同じ結果にする
- 完了の照合を未購入に限り、サーバーの 2 か所（tRPC・sync.push）とゲストをそろえる

**Non-Goals:**
- ゲストの hooks の完了・取り消しの置き換え（O7/O8）

## Decisions

### D1. 正にするもの（`179-shopping-domain-rules` の D1 からの変更）

| 規則 | 179 の後 | この change | 理由 |
|------|---------|------------|------|
| 完了: チェック 0 件 | サーバーは完了できる（空の履歴）、ゲストは例外、画面は押せない | 画面でダイアログを出して削除方法を選ぶ。サーバーは断る（tRPC: BAD_REQUEST、sync.push: conflict `no_checked_items`）。ゲストの `finishShopping` の例外は残す | ユーザーの決定（2026-11-17）。サーバーで勝手に消さない（確認事項 4） |
| 完了: カタログの照合 | 名前・スコープ・未削除。購入済みも上書き | 名前・スコープ・未削除・**未購入** | 前の購入の記録を書き換えない（確認事項 5）。ゲストは今も未購入だけ |
| 0 件の「商品ごと消す」の照合 | （新規） | 名前・スコープ・未削除・未購入 | 確認事項 2 |

### D2. domain の変更

- `planFinishShopping` に `{ ok: false, reason: "no_checked_items" }` を足す（進行中の確認の後に判定）
- `selectItemsToPurchase` を未購入だけに絞る
- `selectItemsToDeleteWithList`（`catalogMatch.ts`）を足す: 名前・スコープ・未削除・未購入

### D3. サーバー

- tRPC の完了: `no_checked_items` を `ShoppingDomainError`（BAD_REQUEST）にする。メッセージは「カゴに入れた商品がありません」
- sync.push: `no_checked_items` を conflict の reason `no_checked_items` にし、サーバーの行を返す。今の SyncEngine は conflict をすべて「サーバーの行で戻す + トースト」で扱うので、クライアントの追加の対応はいらない
- `deleteListSchema` に `deleteCatalogItems?: boolean` を足す。true なら、`ShoppingSyncService.deleteHistory` と同じ形で、1 トランザクションの中でリストの行をロック（`notDeleted`・`accessibleByUser`）してリストの商品と候補を読み、`selectItemsToDeleteWithList` で選んで論理削除（item_tags も消す）し、リストを論理削除する。同期の記録（リストと各カタログの商品の `delete`）はコミットの後に書く（`deleteHistory` と同じ）
- 指定はリストの状態（進行中・完了）とチェックの有無を問わずに受ける。画面から使うのは 0 件の完了だけだが、API としては「リストと同じ名前の未購入の商品も消す削除」で意味が決まっていて、断る理由がないため。完了済みのリストは購入履歴の削除（`deleteHistory`）を使うので、画面からは届かない

### D4. クライアント（画面と、ゲストの `deleteList` だけ）

- `app/lists/detail/page.tsx`: チェック 0 件のとき、完了ボタンを押せるようにし、押すと BottomSheet のダイアログを出す。選んだ方法で `deleteList(listId, { deleteCatalogItems })` を呼び、`/lists` に移る。`finishShopping` は呼ばない
- `useListMutations.deleteList`: サーバーのときは tRPC にそのまま渡す。ゲストのときは、**リストの** groupId と同じ groupId・同じ名前・未購入の商品を `selectItemsToDeleteWithList` で選び、カタログの商品・リストの商品・リストの削除を Dexie の 1 つのトランザクション（`items`・`listItems`・`lists`）で行う。ゲストのリストの商品の groupId は item のものとリストのものが混在している（design-doc 7.1）ので、リストの商品の groupId は使わない。ゲストの商品は userId を持たないので、リストと商品の両方に同じ固定の所有者を入れたスコープを渡す
- 完了の失敗: `handleComplete` は今 `console.error` だけなので、エラーのメッセージを画面に出し（既存のトーストか、ボタンの下の文言）、リストを読み直す

### D5. DB

スキーマ・migration・Dexie の version の変更はない。

## Risks / Trade-offs

- [完了の照合を未購入に限ると、前に購入済みの同じ名前の商品は「最後に買った日」が更新されなくなる] → 確認事項 5 でユーザーに確かめる
- [開いたままの古い画面が 0 件の完了を送るとエラーになる] → 今の画面は 0 件で押せないので、送るのは特殊な場合（ほかの端末でチェックが外れた後など）だけ。エラーを出してリストを読み直す
- [ゲストの「商品ごと消す」だけ domain を使い、ほかの hooks は古いまま] → O7/O8 で置き換える

## Migration Plan

DB の変更がないので、通常の develop へのマージで出す。戻すときは revert でよい（API の追加項目は省略可）。
