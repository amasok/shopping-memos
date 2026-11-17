# Design: チェック 0 件の完了でリストの削除を選ばせる

## Context

動機は proposal.md の Why。`179-shopping-domain-rules` で、完了・照合の規則は `src/modules/shopping/domain/services/` の純粋関数（`planFinishShopping`・`catalogMatch.ts`）になり、tRPC と sync.push が同じ関数を通る。ただし振る舞いは今のサーバーのまま（0 件でも完了でき、照合は購入済みも上書き）。この change はその関数を変える。O8（#182）で、ゲストとローカルファーストの買い物の読み書きは `src/infrastructure/local/shoppingRepository.ts` にまとまり、完了は `FinishRules`（`server` = ローカルファーストはサーバーと同じ、`guest` = 0 件はエラー・未購入だけ）で分かれている。画面（`app/lists/detail/page.tsx`）の完了ボタンは今、チェック 0 件で押せない。

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
| 完了: チェック 0 件 | サーバーとローカルファーストは完了できる（空の履歴）、ゲストは例外、画面は押せない | 画面でダイアログを出して削除方法を選ぶ。サーバーは断る（tRPC: BAD_REQUEST、sync.push: conflict `no_checked_items`）。端末の DB の `finishShopping` は、ゲストもローカルファーストも例外にする | ユーザーの決定（2026-11-17）。サーバーで勝手に消さない（確認事項 4）。3 つのモードでそろえる（確認事項 6） |
| 完了: カタログの照合 | 名前・スコープ・未削除。サーバーとローカルファーストは購入済みも上書き | 名前・スコープ・未削除・**未購入** | 前の購入の記録を書き換えない（確認事項 5）。ゲストは今も未購入だけ |
| 0 件の「商品ごと消す」の照合 | （新規） | 名前・スコープ・未削除・未購入 | 確認事項 2 |

### D2. domain の変更

- `planFinishShopping` に `{ ok: false, reason: "no_checked_items" }` を足す（進行中の確認の後に判定）
- `selectItemsToPurchase` を未購入だけに絞る
- `selectItemsToDeleteWithList`（`catalogMatch.ts`）を足す: 名前・スコープ・未削除・未購入

### D3. サーバー

- tRPC の完了（`ShoppingService.finishShopping`）: `no_checked_items` を `ShoppingDomainError`（BAD_REQUEST）にする。メッセージは「カゴに入れた商品がありません」
- sync.push: `no_checked_items` を conflict の reason `no_checked_items` にし、サーバーの行を返す。今の SyncEngine は conflict をすべて「サーバーの行で戻す + トースト」で扱うので、クライアントの追加の対応はいらない
- `deleteListSchema` に `deleteCatalogItems?: boolean` を足す（`getList` も `deleteListSchema` を入力にしているので、`getList` は id だけのスキーマに分ける）。true なら、`ShoppingSyncService.deleteHistory` と同じ形で、1 トランザクションの中でリストの行をロック（`lockAccessibleList`。`notDeleted`・`accessibleByUser`）してリストの商品と候補（`findScopedCandidatesByNames`）を読み、`selectItemsToDeleteWithList` で選んで論理削除（item_tags も消す。`catalogItemScope.ts` に ID で消す関数を足す）し、リストを論理削除する。同期の記録（リストと各カタログの商品の `delete`）はコミットの後に書く（`deleteHistory` と同じ）
- 指定はリストの状態（進行中・完了）とチェックの有無を問わずに受ける。画面から使うのは 0 件の完了だけだが、API としては「リストと同じ名前の未購入の商品も消す削除」で意味が決まっていて、断る理由がないため。完了済みのリストは購入履歴の削除（`deleteHistory`）を使うので、画面からは届かない

### D4. クライアント（画面と端末の DB）

- `app/lists/detail/page.tsx`: チェック 0 件のとき、完了ボタン（`partial-complete-button`）を「買い物を完了」にして押せるようにし、押すと BottomSheet のダイアログを出す。選んだ方法で `deleteList(listId, { deleteCatalogItems })` を呼び、`/lists` に移る。`finishShopping` は呼ばない
- `useListMutations.deleteList(id, options?)`: サーバーファーストは tRPC に `deleteCatalogItems` を渡す（成功したらカタログの一覧も読み直す）。ゲストとローカルファーストは `shoppingRepository.deleteList(store, id, options)` に渡す
- `shoppingRepository.deleteList` の指定: `deleteCatalogItems` が true なら、同じトランザクション（`lists`・`listItems`・`items`・`syncQueue`）の中で、`candidatesFor`（**リストの** groupId と同じ商品。固定の所有者 `LOCAL_OWNER`）を `selectItemsToDeleteWithList` で選び、`deleteRecord` で消してから、今の手順でリストの商品とリストを消す。ローカルファーストでは、キューにカタログの商品・リストの商品・リストの `delete` がこの順に積まれる（`deleteRecord` が積む）。ゲストはキューに積まない。ゲストのリストの商品の groupId は item のものとリストのものが混在している（design-doc 7.1）ので、リストの商品の groupId は使わない
- 端末の DB の完了: `FinishRules` をなくし、ゲストもローカルファーストも「0 件はエラー（『購入済みのアイテムがありません』）、照合は未購入だけ」にする。0 件の判定は `planFinishShopping` の `no_checked_items` を使う
- 完了の失敗: `handleComplete` は今 `console.error` だけなので、エラーのメッセージをボタンの下の文言（`role="alert"`）で出し、リストを読み直す（トーストの仕組みはまだない）。画面は 0 件で完了を呼ばないので、エラーになるのはほかの端末と競合したとき（サーバーファーストで、ほかの端末がチェックを外した後など）だけ

### D5. DB

スキーマ・migration・Dexie の version の変更はない。

## Risks / Trade-offs

- [完了の照合を未購入に限ると、前に購入済みの同じ名前の商品は「最後に買った日」が更新されなくなる] → 確認事項 5 でユーザーに確かめる
- [開いたままの古い画面が 0 件の完了を送るとエラーになる] → 今の画面は 0 件で押せないので、送るのは特殊な場合（ほかの端末でチェックが外れた後など）だけ。エラーを出してリストを読み直す
- [ローカルファーストで、端末ではチェック 1 件以上で完了したが、先にほかの端末がチェックを外して push していた] → sync.push が conflict（`no_checked_items`）を返し、今の SyncEngine がサーバーの行で戻す（`already_completed` など、ほかの完了の conflict と同じ扱い）

## Migration Plan

DB の変更がないので、通常の develop へのマージで出す。戻すときは revert でよい（API の追加項目は省略可）。
