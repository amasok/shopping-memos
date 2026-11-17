# Proposal: 買い物の規則を共用のドメイン関数にまとめる

Issue: #179（https://github.com/amasok/shopping-memos/issues/179）

## Why

「買い物を完了する」「履歴を取り消す」「商品からリストの行を作る（スナップショット）」「カタログとの照合」「進行中のリストでの除外」の規則が、サーバーの tRPC（`ShoppingService`・`routers/shopping.ts`）、sync.push（`SyncPushService`）、クライアントの hooks に重複し、中身が食い違っている（`docs/design-doc.md` の 7.1）。#62 の O8 でクライアントにもう 1 か所作る前に、規則を shopping の domain の純粋関数に 1 つだけ置き、まずサーバーの 2 か所をそれに置き換える。

## What Changes

- shopping の domain に、Drizzle・Dexie・tRPC を import しない純粋関数を足す: 買い物の完了の計画、履歴の取り消しの計画、カタログとの照合（購入済みにする・未購入に戻す）、リストの商品のスナップショット、進行中のリストでの除外。所有スコープの判定（`isSameScope`）は共有カーネル（`src/shared/`）に移し、domain から使えるようにする
- サーバーを置き換える: `ShoppingService.finishShopping`、`routers/shopping.ts` の `revertHistory`（本体を `ShoppingService` に移す）、`SyncPushService` の `finishShopping` / `revertHistory`、`routers/shopping.ts` のスナップショットの 4 か所、`routers/catalog.ts` の除外の絞り込み
- 関数の規則は **今のサーバーの振る舞いのまま** にする。ユーザーから見える結果（成功・失敗・エラーの種類・データの最終状態）は変えない。チェック 0 件でも完了でき（空の購入履歴になる）、完了の照合は同じ名前の購入済みの商品の購入日時も上書きし、購入履歴でないリストの取り消しは NOT_FOUND のまま。0 件の完了と照合の変更は別の change `179b-finish-empty-list-dialog`（ユーザーの確認待ち）で行う
- 結果を変えない内部の直し（リーダーの判断、2026-11-17。成功したときの最終状態が今と同じことをテストで示す）:
  - tRPC の履歴の取り消しを 1 つのトランザクションにする（今は途中で失敗すると一部だけ反映される）
  - tRPC の完了で、リストの行をロックしてからリストの商品をトランザクションの中で読む（今は外で読む。sync.push と同じにする）
  - 名前ごとの UPDATE（N+1）を、候補の SELECT 1 回と id での UPDATE 1 回にする

## Capabilities

### New Capabilities

- `shopping`: 買い物リストの完了・履歴の取り消し・リストの商品のスナップショット・カタログとの照合・「買いたいもの」の一覧での進行中のリストの除外。この change で、触れる範囲の今の振る舞い（境界のケースを含む）を書き起こす

### Modified Capabilities

なし（`openspec/specs/` はまだ空）

## 影響するモード

| モード | 影響 |
|-------|------|
| ゲスト（Dexie だけ） | なし（hooks は O7/O8 で domain の関数に置き換える） |
| サーバーファースト（tRPC） | 置き換えの対象。見える結果は変えない（取り消しのトランザクションなど、失敗や競合のときの内部の直しだけ） |
| ローカルファースト（`NEXT_PUBLIC_LOCAL_FIRST`） | 画面はまだ tRPC を使う（O6 の時点）のでサーバーファーストと同じ。sync.push の `finishShopping` / `revertHistory` が domain の関数を通る（結果は今と同じ） |

## Non-goals

- チェック 0 件の完了のダイアログ、完了の照合を未購入に限ること（`179b-finish-empty-list-dialog`）
- クライアントの hooks（`useListMutations`・`useHistoryMutations`・`useItems`）の置き換え（O7/O8。`docs/design-doc.md` 10 の (3)）
- router を薄くする・ポートで依存の向きを直す・コンテキストをまたぐ import をなくすこと（R3 の後の (4)）
- 履歴の取り消しで「この履歴で買った商品だけ」を戻すこと（今は同じ名前・同じスコープの購入済みをすべて戻す）
- 履歴の削除（`deleteHistory`）の照合の変更
- DB・Dexie のスキーマの変更（ない）

## Impact

- 追加: `src/modules/shopping/domain/services/*`（純粋関数とテスト）、`src/shared/domain/ownerScope.ts`（`isSameScope` と `OwnerScope` を移す）
- 変更: `src/modules/shopping/application/services/ShoppingService.ts`・`catalogItemScope.ts`、`src/modules/sync/application/services/SyncPushService.ts`、`src/infrastructure/trpc/routers/shopping.ts`・`catalog.ts`、`src/infrastructure/db/ownership.ts`（移した関数を取り除き、shared から import する。再エクスポートはしない）、`isSameScope`・`OwnerScope` を使う各所の import、`eslint.config.mjs`（import の制限）
- API: 入出力・エラーの種類は変わらない
- DB の migration: なし

## ユーザーに確認すること

なし。ユーザーの確認が要るものは `179b-finish-empty-list-dialog` に分けた（リーダーの指示、2026-11-17。ユーザーの不在中は、確認が要るものを保留にして進める）。
