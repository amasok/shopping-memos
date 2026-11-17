# Proposal: 買い物の規則を共用のドメイン関数にまとめ、チェック 0 件の完了でリストの削除を選ばせる

Issue: #179（https://github.com/amasok/shopping-memos/issues/179）

## Why

「買い物を完了する」「履歴を取り消す」「商品からリストの行を作る（スナップショット）」「カタログとの照合」「進行中のリストでの除外」の規則が、サーバーの tRPC（`ShoppingService`・`routers/shopping.ts`）、sync.push（`SyncPushService`）、クライアントの hooks に重複し、中身が食い違っている（`docs/design-doc.md` の 7.1）。#62 の O8 でクライアントにもう 1 か所作る前に、規則を shopping の domain の純粋関数に 1 つだけ置き、まずサーバーの 2 か所をそれに置き換える。あわせて、チェック 0 件で完了したときの振る舞い（今はサーバーは空の履歴を作り、ゲストは例外、画面はボタンを押せない）を、ユーザーの決定どおりにそろえる。

## What Changes

- shopping の domain に、Drizzle・Dexie・tRPC を import しない純粋関数を足す: 買い物の完了の計画、履歴の取り消しの計画、カタログとの照合（購入済みにする・未購入に戻す・リストと一緒に消す）、リストの商品のスナップショット、進行中のリストでの除外。所有スコープの判定（`isSameScope`）は共有カーネル（`src/shared/`）に移し、domain から使えるようにする
- サーバーを置き換える: `ShoppingService.finishShopping`、`routers/shopping.ts` の `revertHistory`（本体を `ShoppingService` に移す）、`SyncPushService` の `finishShopping` / `revertHistory`、`routers/shopping.ts` のスナップショットの 4 か所、`routers/catalog.ts` の除外の絞り込み
- **振る舞いの変更（ユーザーの決定、2026-11-17）**: チェック済みが 0 件で「買い物を完了」したときは、確認ダイアログで「リストの商品ごと消す」か「リストだけ消して商品は元に戻す」を選ばせ、そのうえでリストを削除する。履歴は作らない
  - 画面: 今は 0 件だと押せない（「カゴに入れたものがありません」）完了ボタンを押せるようにし、押すとダイアログを出す
  - tRPC の `deleteList` に、リストの商品と同じ名前・同じスコープの未購入のカタログの商品も消す指定（省略可。既定は消さない）を足す。ゲストの `deleteList` にも同じ指定を足す
  - サーバーに 0 件の完了が届いたら（古い画面や、ほかの端末でチェックが外れた場合）、リストを変えずに断る（tRPC は BAD_REQUEST、sync.push は conflict の `no_checked_items`）
- **振る舞いの変更（食い違いの解消）**:
  - 完了のカタログの照合を、未購入の商品に限る（今のサーバーは、同じ名前の購入済みの商品の購入日時も上書きする）
  - tRPC の履歴の取り消しを、完了済み（購入日時が入っている）のリストに限り、1 つのトランザクションで行う（今は進行中のリストにも通り、途中で失敗すると一部だけ反映される）
  - tRPC の完了で、リストの商品をトランザクションの中で読む（今は外で読む）

## Capabilities

### New Capabilities

- `shopping`: 買い物リストの完了・履歴の取り消し・リストの商品のスナップショット・カタログとの照合・「買いたいもの」の一覧での進行中のリストの除外。この change で、触れる範囲の今の振る舞いを書き起こし、変える部分を加える

### Modified Capabilities

なし（`openspec/specs/` はまだ空）

## 影響するモード

| モード | 影響 |
|-------|------|
| ゲスト（Dexie だけ） | チェック 0 件の完了のダイアログと、「リストの商品ごと消す」（`deleteList` の指定）。完了・取り消しなど、ほかの hooks の処理は変えない（O7/O8 で domain の関数に置き換える） |
| サーバーファースト（tRPC） | 置き換えの対象。チェック 0 件の完了のダイアログ、完了の照合を未購入に限る、取り消しの前提とトランザクション |
| ローカルファースト（`NEXT_PUBLIC_LOCAL_FIRST`） | 画面はまだ tRPC を使う（O6 の時点）ので、画面の振る舞いはサーバーファーストと同じ。sync.push の `finishShopping` / `revertHistory` が domain の関数を使い、0 件の完了は conflict になる |

## Non-goals

- クライアントの hooks（`useListMutations`・`useHistoryMutations`・`useItems`）の完了・取り消し・スナップショット・除外を domain の関数に置き換えること（O7/O8 の範囲。`docs/design-doc.md` 10 の (3)）
- router を薄くする・ポートで依存の向きを直す・コンテキストをまたぐ import をなくすこと（R3 の後の (4)）
- 履歴の取り消しで「この履歴で買った商品だけ」を戻すこと（今は同じ名前・同じスコープの購入済みをすべて戻す。変えるなら別の Issue）
- 履歴の削除（`deleteHistory`）の照合の変更
- DB・Dexie のスキーマの変更（ない）

## Impact

- 追加: `src/modules/shopping/domain/services/*`（純粋関数とテスト）、`src/shared/domain/ownerScope.ts`（`isSameScope` を移す）
- 変更: `src/modules/shopping/application/services/ShoppingService.ts`・`catalogItemScope.ts`・`ShoppingSyncService.ts`、`src/modules/sync/application/services/SyncPushService.ts`、`src/infrastructure/trpc/routers/shopping.ts`・`catalog.ts`、`src/infrastructure/db/ownership.ts`（移した関数を再エクスポート）、`src/shared/schemas/list.ts`（`deleteListSchema`）、`src/hooks/data/useListMutations.ts`（`deleteList` の指定だけ）、`src/app/lists/detail/page.tsx`（ダイアログ）
- API: `shopping.deleteList` の入力に省略可の項目が増える（後方互換）。`shopping.finishShopping` はチェック 0 件で BAD_REQUEST、`shopping.revertHistory` は完了済みでないリストで BAD_REQUEST になる。sync.push の結果の reason に `no_checked_items` が増える
- DB の migration: なし

## ユーザーに確認すること

specs と design は、各項目の「提案」で書いている。違う答えなら specs を直す。

1. **「商品は元に戻す」の意味**: カタログの商品は変えず（未購入のまま）、リストがなくなることで「買いたいもの」の一覧にまた出る状態にする、でよいか。（リストの商品と同じ名前の購入済みの商品を未購入に戻すことはしない）
   - 提案: このとおり（今の「リストを削除」と同じ結果）
2. **「リストの商品ごと消す」で消すカタログの商品の範囲**: リストの商品と同じ名前・同じスコープ（同じグループ、または個人のリストなら作成者の個人の商品）の、未購入の商品だけを消す。同じ名前の購入済みの商品（ほかの履歴で買ったもの）は残す、でよいか
   - 提案: このとおり。なお、履歴の削除は購入済みも含めて同じ名前の商品をすべて消しているが、それは変えない
3. **ダイアログと完了ボタンの文言**（提案）
   - チェック 0 件のときの完了ボタン: 「買い物を完了」（今は押せない「カゴに入れたものがありません」）
   - ダイアログのタイトル: 「カゴに入れたものがありません」
   - 本文: 「履歴は作らずに、このリストを削除します。リストの商品はどうしますか？」
   - ボタン: 「リストの商品ごと消す」（赤）/「リストだけ消して商品は元に戻す」/「キャンセル」
   - 削除の後は買い物リストの一覧（`/lists`）に移る
4. **サーバーに 0 件の完了が届いたとき**（画面を開いたまま、ほかの端末でチェックが外れた場合など）: リストは変えずに断り、画面にはエラーを出す（sync.push は conflict にして、端末のリストをサーバーの状態に戻す）。サーバー側で勝手にリストを消したり空の履歴を作ったりしない、でよいか
   - 提案: このとおり
5. **完了のカタログの照合を未購入に限る**: 今のサーバーは、チェック済みの商品と同じ名前の購入済みの商品（前に買ったもの）の購入日時も、今回の時刻に上書きする。ゲストは未購入だけを変える。未購入だけにそろえてよいか
   - 提案: 未購入だけ（前の購入の記録を書き換えない）
6. **この change に入れるクライアントの変更の範囲**: 0 件の完了のダイアログ（画面）と、ゲストの `deleteList` の指定だけを入れ、ほかの hooks は O7/O8 で置き換える、でよいか
   - 提案: このとおり。ダイアログはユーザーの決定どおりに 3 つのモードでそろえる必要があり、O8 まで待てないため
