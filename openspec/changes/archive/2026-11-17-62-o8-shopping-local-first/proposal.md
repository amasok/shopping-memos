# Proposal: 買い物（リスト・リストの商品・履歴）をローカルファーストに移す（#62 O8）

Issue: #62（https://github.com/amasok/shopping-memos/issues/62）の O8。設計の正は `docs/features/offline-support.md`（#62 が終わるまで）

## Why

O7 でカタログはローカルファーストになったが、買い物（リストの作成・商品の追加とチェック・買い物の完了・履歴の取り消し）はまだ tRPC だけで、オフラインでは店で買い物ができない。また、ゲストの hooks には #179 の規則とは別のコピー（完了・取り消し・スナップショット・照合）が残っている（design-doc 7.1）。買い物の読み書きを端末の DB とリポジトリ経由にし、規則は #179 の domain の関数に寄せる。O9 と一緒に R3 で出す。

## What Changes

- `LocalShoppingRepository`（`src/infrastructure/local/shoppingRepository.ts`）を足す: リストの作成（商品・タグからのスナップショット）・名前の変更・削除、リストへの商品の追加（カタログの商品から / 新しく作る）・外す・チェック、買い物の完了、履歴の取り消し・削除。どれも Dexie の 1 トランザクションで、行と同期のキューを書く
  - 完了と取り消しは、#179 の `planFinishShopping` / `planRevertHistory` と `catalogMatch` で端末の DB を更新し、キューには複合操作（`finishShopping` / `revertHistory`）を 1 つだけ積む（サーバーが同じ規則で 1 トランザクションで適用する）
  - スナップショットは `snapshotListItem`（groupId はリストのもの）
- `useLists` / `useListsWithItems` / `useList` / `useHistory` と `useListMutations` / `useHistoryMutations` を、O7 の経路（`useCatalogSource`）で切り替える。ゲストはキューに積まないモードで同じリポジトリを通り、hooks のゲスト用のコピーをなくす
  - フラグが false のログイン中は今の tRPC のまま
  - ローカルファーストの並びはサーバーと同じ（リストとリストの商品は作成の古い順、履歴は購入日時の新しい順）。初回の同期が終わるまでは読み込み中
- ゲストの振る舞いは、見える結果を今のまま残す（ユーザーの確認が要るものは保留）
  - チェック 0 件の完了で例外、完了の照合は未購入だけ: `179b-finish-empty-list-dialog` の確認事項と重なるので、O8 では今のまま
  - リストとリストの商品の並び: そろえるのは見える変化なので、保留の change `62-o8b-shopping-guest-order` に分けた
- O7 の「買い物の変更の後の同期」（tRPC の買い物の後に `engine.sync()`）は、買い物も端末の DB に書くので要らなくなる。サーバーファーストの `catalog.getItems` の invalidate は残す
- `docs/features/offline-support.md` の O8 の行と、O8 での細部を書く

## Capabilities

### New Capabilities

なし

### Modified Capabilities

- `shopping`: 端末の DB（ゲスト・ローカルファースト）の買い物の読み書きの Requirement を足す。サーバーの Requirement（完了・取り消し・スナップショット・照合・除外）は変えない
- `catalog`: 「買い物の変更の後の同期」を、サーバーファーストの invalidate だけに置き換える（REMOVED + ADDED。MODIFIED では Scenario を落とせないため）

## 影響するモード

| モード | 影響 |
|-------|------|
| ゲスト | 書き込みがリポジトリ経由になる。見える結果は今のまま（並び・0 件の完了の例外・未購入だけの照合を含む）。完了したリストへの商品の追加・チェック・外すは、画面からはできないが、リポジトリでも断るようになる |
| サーバーファースト（フラグ false。本番の今の状態） | 変わらない |
| ローカルファースト（フラグ true） | 買い物の読み書きがユーザー DB とキューを使い、オフラインでも買い物ができる。本番ではまだ有効にしない（R3） |

## Non-goals

- チェック 0 件の完了のダイアログ・照合を未購入に限ること（`179b-finish-empty-list-dialog`）
- ゲストのリストとリストの商品の並びをそろえること（`62-o8b-shopping-guest-order`）
- オフラインのセッション・同期の状態の UI・ログアウト時のユーザー DB の削除（O9）
- サーバーの API・DB の変更（ない）
- フラグを true にした E2E（O9）

## Impact

- 追加: `src/infrastructure/local/shoppingRepository.ts`、`src/hooks/data/shoppingQueries.ts`（端末の DB の読み取り）
- 変更: `src/hooks/data/useLists.ts`・`useHistory.ts`・`useListMutations.ts`・`useHistoryMutations.ts`・`useCatalogSource.ts`（`refreshCatalog` を server だけに）、`docs/features/offline-support.md`
- API・DB の migration・Dexie の version: 変更なし

## ユーザーに確認すること

なし（確認が要るものは `62-o8b-shopping-guest-order` と、既にある `179b-finish-empty-list-dialog` に分けた。リーダーの指示、2026-11-17）。
