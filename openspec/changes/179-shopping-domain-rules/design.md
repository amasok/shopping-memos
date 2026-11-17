# Design: 買い物の規則を共用のドメイン関数にまとめる

## Context

動機は proposal.md の Why。今の実装の食い違いは `docs/design-doc.md` の 7.1。この change で関わる今の流れ:

- tRPC の完了: `routers/shopping.ts` の `finishShopping` → `ShoppingService.finishShopping`。リストの商品はトランザクションの外で読み、`catalogItemScope.markScopedItemsPurchasedByName` で名前ごとに UPDATE（購入済みの行も上書き）
- tRPC の取り消し: `routers/shopping.ts` の `revertHistory` に本体があり、トランザクションなし。前提の確認なし
- sync.push: `SyncPushService.finishShopping` / `revertHistory`。1 トランザクション、リストの行はロック済み、操作の時刻（opTime）で LWW
- スナップショット: `routers/shopping.ts` の 4 か所（createList の itemIds・tagIds、addItemToList、addNewItemToList）
- 除外: `routers/catalog.ts` の `getItems`（進行中・未削除のリストの、未削除の商品の名前を SQL で読み、名前で除く）

## Goals / Non-Goals

**Goals:**
- 規則を `src/modules/shopping/domain/services/` の純粋関数に 1 つだけ置き、サーバーの tRPC と sync.push が同じ関数を通る
- 照合を「SQL の UPDATE の WHERE」から「候補を読む → domain で選ぶ → id で書く」に変え、規則が SQL に埋もれないようにする
- 振る舞いは今のサーバーのまま。直すのは、ユーザーの確認に関係しないサーバーの 2 か所の間の食い違いだけ（D1）

**Non-Goals:**
- チェック 0 件の完了・照合の未購入への限定（`179b-finish-empty-list-dialog`）。この change の関数は、179b で引数か分岐を足して変えられる形にしておく
- クライアントの hooks の置き換え、router を薄くすること、ポートの導入（proposal.md の Non-goals）
- `catalogItemScope.ts` の削除（`deleteHistory` が使う `deleteScopedItemsByName` は残す）

## Decisions

### D1. 食い違っている規則と、この change で正にするもの

| 規則 | tRPC | sync.push | ゲスト | この change で正にするもの | 理由 |
|------|------|-----------|--------|------------------------|------|
| 完了: チェック 0 件 | 空の履歴を作る | 空の履歴を作る | 例外 | 今のサーバーのまま（完了できる） | ユーザーの決定（ダイアログ）と確認事項があるので 179b で変える |
| 完了: 状態の確認 | `isInProgress` / `canTransition` | status と LWW（`stale`） | しない | 進行中であること（domain）。LWW は sync の層に残す | サーバーの 2 か所は同じ結果。状態の規則は domain、時刻の比較は同期の都合 |
| 完了: カタログの照合 | 名前・スコープ・未削除。購入済みも上書き | 名前・スコープ・未削除・LWW。購入済みも上書き | 名前・未購入（スコープなし） | 今のサーバーのまま（名前・スコープ・未削除。sync.push は LWW も） | 未購入に限るかはユーザーの確認が要る（179b） |
| 完了: 未チェックの商品 | 論理削除 | 論理削除 | 物理削除 | リストから外す（サーバーは論理削除。消し方は infrastructure） | 規則は「外す」だけ。消し方は保存先の都合 |
| 完了: リストの商品を読む時点 | トランザクションの外 | 中（リストをロック） | — | **トランザクションの中で、リストの行をロックしてから読む** | 読んだ後のチェックの変更を取りこぼさない。sync.push にそろえる |
| 取り消し: 前提 | なし | 購入日時あり | 購入日時あり | **購入日時が入っていること（domain）。tRPC は BAD_REQUEST** | 「購入日時の入ったリスト」が履歴の定義（design-doc 3）。sync.push・ゲストにそろえる |
| 取り消し: カタログの照合 | 名前・スコープ・未削除・購入済み | 同じ + LWW | 名前・購入済み（スコープなし） | 今のサーバーのまま | サーバーの 2 か所は同じ（「この履歴で買った分だけ」は Non-goals） |
| 取り消し: トランザクション | なし | 1 つ | — | **1 つ** | 一部だけ反映されるのを防ぐ。sync.push にそろえる |
| スナップショットの groupId | リストの groupId | —（クライアントの行をそのまま受ける） | item とリストが混在 | リストの groupId（サーバーのまま） | ゲストの混在は O7/O8 でこの関数に置き換えて解く |
| 除外の範囲 | 進行中・未削除のリストの未削除の商品。グループはその groupId、個人は groupId なし・自分 | — | 進行中のリストを groupId だけで | サーバーのまま | ゲストは O8 で置き換える |

太字が振る舞いの変わる直し。どれも tRPC を sync.push にそろえるもので、ユーザーの確認に関係しない（リーダーの指示、2026-11-17）。

### D2. domain の関数（`src/modules/shopping/domain/services/`）

Drizzle・Dexie・tRPC・`@/infrastructure` を import しない。入力は domain で定義する最小の型（行の型を受けない）で、時刻は引数で受ける（`new Date()` を中で呼ばない）。

| ファイル | 関数 | 入力 → 出力 |
|---------|------|-----------|
| `finishShopping.ts` | `planFinishShopping` | リストの状態・リストの商品（id・名前・チェック）・時刻・場所 → `{ ok: true, listState, purchaseNames, removeEntryIds }` か `{ ok: false, reason: "not_in_progress" }` |
| `revertHistory.ts` | `planRevertHistory` | リストの購入日時・リストの商品の名前 → `{ ok: true, listState, revertNames }` か `{ ok: false, reason: "not_completed" }` |
| `catalogMatch.ts` | `selectItemsToPurchase` / `selectItemsToUnpurchase` | 名前の一覧・カタログの候補（id・名前・所有スコープ・購入日時・削除済みか）・リストのスコープ → 一致した商品の id。購入済みにするほうは購入状態を見ない（今のサーバー）、未購入に戻すほうは購入済みだけ |
| `snapshot.ts` | `snapshotListItem` | カタログの商品（名前・数量・メモ・タグの id）・リスト（id・groupId）・新しい id → リストの商品の作成入力（未チェック） |
| `activeListExclusion.ts` | `excludeItemsInActiveLists` | カタログの商品・進行中のリストの商品の名前 → 一覧に出す商品 |

- 理由の値と sync.push の conflict の reason の対応は sync の層で決める（`not_in_progress` → 今の `already_completed`、`not_completed` → `not_completed`。reason の文字列は変えない）
- 除外の「どのリストが進行中で同じスコープか」はサーバーでは SQL の条件のまま残し、名前での除外だけ domain を使う。クライアントで使うとき（O8）は同じ条件の述語を domain に足す
- 所有スコープの判定 `isSameScope` と型 `OwnerScope` は `src/infrastructure/db/ownership.ts` から `src/shared/domain/ownerScope.ts` に移し、ownership.ts は再エクスポートする（定義は 1 つのまま。#101）。domain は shared だけを import する

代替案: 照合を SQL の WHERE に残し、domain は「名前の一覧」だけを返す。→ スコープ・購入状態の規則が SQL とクライアントのフィルタに分かれたままになり、O8 でまたずれるので採らない。

### D3. サーバーの組み立て（application 層）

- 完了・取り消しの I/O の手順を `src/modules/shopping/application/services/` の関数（例: `applyFinishShopping(tx, listRow, at, opTime?)`・`applyRevertHistory(...)`）にまとめ、tRPC（`ShoppingService`）と sync.push（`SyncPushService`）の両方から呼ぶ。手順: リストの行をロック → リストの商品を読む → `plan*` → 候補を `name IN (...)` とスコープ・未削除で 1 回で読む → `select*` で選ぶ → id の一覧で 1 回で UPDATE（sync.push は `fieldNotNewerThan` を WHERE に足す）→ 外す商品を論理削除 → リストを更新
- 名前ごとの UPDATE（N+1）が、候補の SELECT 1 回と UPDATE 1 回になる
- tRPC の取り消しは `ShoppingService.revertHistory` に移し、1 トランザクションにする。同期の記録（`sync_operations`）は今と同じくコミットの後に書く
- 依存の向き: router（infrastructure）→ application → domain、application → shared。sync の application が shopping の application を呼ぶのは今と同じ（7.5 の解消は Non-goals）。catalog の router が shopping の domain（除外）を使うのは、「買いたいもの」の一覧が shopping の状態に依存する読み取りのため。catalog の domain・application は shopping に依存しない

### D4. DB

スキーマ・migration・Dexie の version の変更はない。リリース手順への影響もない。

## Risks / Trade-offs

- [照合を「読んでから書く」にすると、読んだ後に別の処理が同じ商品を変えうる] → トランザクションの中でリストの行をロックしてから読む。カタログの商品の購入日時は、tRPC は後勝ち、sync.push は LWW の条件を UPDATE に残すので、今より悪くならない
- [tRPC の取り消しが、購入履歴でないリストで BAD_REQUEST になる] → 画面（`app/history/page.tsx`）は購入履歴からだけ呼ぶので、通常の操作では起きない。二重に押したときなどは、今は 2 回目もカタログを書き換えていたのが、エラーになる
- [クライアントの hooks は古いまま] → O7/O8 で置き換える。それまでの間、ゲストの照合（名前だけ・スコープなし）はサーバーとずれたまま（今と同じ）

## Migration Plan

DB の変更がないので、通常の develop へのマージで出す。戻すときは revert でよい。
