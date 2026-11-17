# Proposal: 買い物の規則を共用のドメイン関数にまとめる

Issue: #179（https://github.com/amasok/shopping-memos/issues/179）

## Why

「買い物を完了する」「履歴を取り消す」「商品からリストの行を作る（スナップショット）」「カタログとの照合」「進行中のリストでの除外」の規則が、サーバーの tRPC（`ShoppingService`・`routers/shopping.ts`）、sync.push（`SyncPushService`）、クライアントの hooks に重複し、中身が食い違っている（`docs/design-doc.md` の 7.1）。#62 の O8 でクライアントにもう 1 か所作る前に、規則を shopping の domain の純粋関数に 1 つだけ置き、まずサーバーの 2 か所をそれに置き換える。

## What Changes

- shopping の domain に、Drizzle・Dexie・tRPC を import しない純粋関数を足す: 買い物の完了の計画、履歴の取り消しの計画、カタログとの照合（購入済みにする・未購入に戻す）、リストの商品のスナップショット、進行中のリストでの除外。所有スコープの判定（`isSameScope`）は共有カーネル（`src/shared/`）に移し、domain から使えるようにする
- サーバーを置き換える: `ShoppingService.finishShopping`、`routers/shopping.ts` の `revertHistory`（本体を `ShoppingService` に移す）、`SyncPushService` の `finishShopping` / `revertHistory`、`routers/shopping.ts` のスナップショットの 4 か所、`routers/catalog.ts` の除外の絞り込み
- 関数の規則は **今のサーバーの振る舞いのまま** にする。チェック 0 件でも完了でき（空の購入履歴になる）、完了の照合は同じ名前の購入済みの商品の購入日時も上書きする。これらの変更は別の change `179b-finish-empty-list-dialog`（ユーザーの確認待ち）で行う
- サーバーの 2 か所の間の食い違いのうち、ユーザーの確認に関係しないものは正す（振る舞いの変更）:
  - tRPC の履歴の取り消しを、購入日時が入っているリストに限り（sync.push・ゲストと同じ）、1 つのトランザクションで行う。今は進行中のリストにも通り、途中で失敗すると一部だけ反映される
  - tRPC の完了で、リストの行をロックしてからリストの商品をトランザクションの中で読む（sync.push と同じ）。今は外で読む

## Capabilities

### New Capabilities

- `shopping`: 買い物リストの完了・履歴の取り消し・リストの商品のスナップショット・カタログとの照合・「買いたいもの」の一覧での進行中のリストの除外。この change で、触れる範囲の今の振る舞いを書き起こし、上の 2 つの直しを加える

### Modified Capabilities

なし（`openspec/specs/` はまだ空）

## 影響するモード

| モード | 影響 |
|-------|------|
| ゲスト（Dexie だけ） | なし（hooks は O7/O8 で domain の関数に置き換える） |
| サーバーファースト（tRPC） | 置き換えの対象。振る舞いの変更は、履歴の取り消しの前提（購入履歴でないと BAD_REQUEST）とトランザクション、完了でリストの商品を読む時点だけ |
| ローカルファースト（`NEXT_PUBLIC_LOCAL_FIRST`） | 画面はまだ tRPC を使う（O6 の時点）のでサーバーファーストと同じ。sync.push の `finishShopping` / `revertHistory` が domain の関数を通る（結果は今と同じ） |

## Non-goals

- チェック 0 件の完了のダイアログ、完了の照合を未購入に限ること（`179b-finish-empty-list-dialog`）
- クライアントの hooks（`useListMutations`・`useHistoryMutations`・`useItems`）の置き換え（O7/O8。`docs/design-doc.md` 10 の (3)）
- router を薄くする・ポートで依存の向きを直す・コンテキストをまたぐ import をなくすこと（R3 の後の (4)）
- 履歴の取り消しで「この履歴で買った商品だけ」を戻すこと（今は同じ名前・同じスコープの購入済みをすべて戻す）
- 履歴の削除（`deleteHistory`）の照合の変更
- DB・Dexie のスキーマの変更（ない）

## Impact

- 追加: `src/modules/shopping/domain/services/*`（純粋関数とテスト）、`src/shared/domain/ownerScope.ts`（`isSameScope` を移す）
- 変更: `src/modules/shopping/application/services/ShoppingService.ts`・`catalogItemScope.ts`、`src/modules/sync/application/services/SyncPushService.ts`、`src/infrastructure/trpc/routers/shopping.ts`・`catalog.ts`、`src/infrastructure/db/ownership.ts`（移した関数を再エクスポート）
- API: `shopping.revertHistory` は、購入日時が入っていないリストで BAD_REQUEST になる。ほかの入出力は変わらない
- DB の migration: なし

## ユーザーに確認すること

なし。ユーザーの確認が要るものは `179b-finish-empty-list-dialog` に分けた（リーダーの指示、2026-11-17。ユーザーの不在中は、確認が要るものを保留にして進める）。
