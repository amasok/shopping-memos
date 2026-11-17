# Design: 買い物の規則を共用のドメイン関数にまとめる

## Context

動機は proposal.md の Why。今の実装の食い違いは `docs/design-doc.md` の 7.1。この change で関わる今の流れ:

- tRPC の完了: `routers/shopping.ts` の `finishShopping`（`canAccessList` → FORBIDDEN）→ `ShoppingService.finishShopping`。状態の確認とリストの商品の読み込みはトランザクションの外。トランザクションの中で、リストの UPDATE の WHERE に `notDeleted` と `accessibleByUser`（#73-1）があり、0 行なら「リストが見つかりません」。カタログは `catalogItemScope.markScopedItemsPurchasedByName` で名前ごとに UPDATE（購入済みの行も上書き）し、returning した id を `sync_operations` に記録する
- tRPC の取り消し: `routers/shopping.ts` の `revertHistory` に本体がある。`canAccessHistory` → FORBIDDEN、`getHistoryById`（購入日時がなければ null）→ NOT_FOUND。カタログの UPDATE とリストの UPDATE（repository の `writableList`）は別々で、トランザクションがない
- sync.push: `SyncPushService.finishShopping` / `revertHistory`。使えない行は rejected `not_found`、削除済みは conflict `deleted`。1 トランザクション、リストの行はロック済み、操作の時刻（opTime）で LWW（リストの状態は `stale`、カタログの購入日時は `fieldNotNewerThan`）
- スナップショット: `routers/shopping.ts` の 4 か所（createList の itemIds・tagIds、addItemToList、addNewItemToList）
- 除外: `routers/catalog.ts` の `getItems`（進行中・未削除のリストの、未削除の商品の名前を SQL で読み、名前で除く）

## Goals / Non-Goals

**Goals:**
- 規則を `src/modules/shopping/domain/services/` の純粋関数に 1 つだけ置き、サーバーの tRPC と sync.push が同じ関数を通る
- 照合を「SQL の UPDATE の WHERE」から「候補を読む → domain で選ぶ → id で書く」に変え、規則が SQL に埋もれないようにする
- ユーザーから見える結果（成功・失敗・エラーの種類・データの最終状態）は変えない。内部の正しさの改善（トランザクション・読む時点・N+1）は入れる（リーダーの判断、2026-11-17）

**Non-Goals:**
- チェック 0 件の完了・照合の未購入への限定（`179b-finish-empty-list-dialog`）。この change の関数は、179b で分岐を足して変えられる形にしておく
- クライアントの hooks の置き換え、router を薄くすること、ポートの導入（proposal.md の Non-goals）
- tRPC の `checkItem`・`addItemToList` が親のリストをロックしないこと（Risks）
- `catalogItemScope.ts` の削除（`deleteHistory` が使う `deleteScopedItemsByName` は残す）

## Decisions

### D1. 食い違っている規則と、この change で正にするもの

| 規則 | tRPC | sync.push | ゲスト | この change で正にするもの | 理由 |
|------|------|-----------|--------|------------------------|------|
| 完了: チェック 0 件 | 空の履歴を作る | 空の履歴を作る | 例外 | 今のサーバーのまま（完了できる） | ユーザーの決定（ダイアログ）と確認事項があるので 179b で変える |
| 完了: 状態の確認 | `isInProgress` / `canTransition`（トランザクションの外） | status と LWW（`stale`） | しない | 進行中であること（domain、`canTransition` を通す）。LWW は sync の層に残す | サーバーの 2 か所は同じ結果。状態の規則は domain、時刻の比較は同期の都合 |
| 完了: カタログの照合 | 名前・スコープ・未削除。購入済みも上書き | 名前・スコープ・未削除・LWW。購入済みも上書き | 名前・未購入（スコープなし） | 今のサーバーのまま（名前・スコープ・未削除。sync.push は LWW も） | 未購入に限るかはユーザーの確認が要る（179b） |
| 完了: 未チェックの商品 | 論理削除 | 論理削除 | 物理削除 | リストから外す（サーバーは論理削除。消し方は infrastructure） | 規則は「外す」だけ。消し方は保存先の都合 |
| 完了: リストの商品を読む時点 | トランザクションの外 | 中（リストをロック） | — | トランザクションの中で、リストの行をロックしてから読む（内部の直し） | 完了とほかの sync.push の操作の間で、読んだ後の変更を取りこぼさない |
| 取り消し: 前提 | 購入日時あり（トランザクションの外で `getHistoryById`。なければ NOT_FOUND） | 購入日時あり（conflict `not_completed`） | 購入日時あり | 購入日時が入っていること（domain）。エラーの種類は今のまま（tRPC は NOT_FOUND） | 3 か所とも同じ規則。「購入日時の入ったリスト」が履歴の定義（design-doc 3）。API を変えない（リーダーの判断） |
| 取り消し: カタログの照合 | 名前・スコープ・未削除・購入済み | 同じ + LWW | 名前・購入済み（スコープなし） | 今のサーバーのまま | サーバーの 2 か所は同じ（「この履歴で買った分だけ」は Non-goals） |
| 取り消し: トランザクション | なし | 1 つ | — | 1 つ（内部の直し） | 一部だけ反映されるのを防ぐ |
| スナップショットの groupId | リストの groupId | リストの groupId（listItem の create。#68） | item とリストが混在 | リストの groupId（サーバーのまま） | ゲストの混在は O7/O8 でこの関数に置き換えて解く |
| 除外の範囲 | 進行中・未削除のリストの未削除の商品。グループはその groupId、個人は groupId なし・自分 | — | 進行中のリストを groupId だけで | サーバーのまま | ゲストは O8 で置き換える |

### D2. domain の関数（`src/modules/shopping/domain/services/`）

Drizzle・Dexie・tRPC・`@/infrastructure` を import しない。入力は domain で定義する最小の型（行の型を受けない）で、時刻は引数で受ける（`new Date()` を中で呼ばない）。

| ファイル | 関数 | 入力 → 出力 |
|---------|------|-----------|
| `finishShopping.ts` | `planFinishShopping` | リストの状態・リストの商品（id・名前・チェック）・時刻・場所 → `{ ok: true, listState, purchaseNames, removeEntryIds }` か `{ ok: false, reason: "not_in_progress" }` |
| `revertHistory.ts` | `planRevertHistory` | リストの購入日時・リストの商品の名前 → `{ ok: true, listState, revertNames }` か `{ ok: false, reason: "not_completed" }` |
| `catalogMatch.ts` | `selectItemsToPurchase` / `selectItemsToUnpurchase` | 名前の一覧・カタログの候補（id・名前・所有スコープ・購入日時・削除済みか）・リストのスコープ → 一致した商品の id。購入済みにするほうは購入状態を見ない（今のサーバー）、未購入に戻すほうは購入済みだけ |
| `snapshot.ts` | `snapshotListItem` | カタログの商品（名前・数量・メモ・タグの id）・リスト（id・groupId）・新しい id → リストの商品の作成入力（未チェック） |
| `activeListExclusion.ts` | `excludeItemsInActiveLists` | カタログの商品・進行中のリストの商品の名前 → 一覧に出す商品 |

- **状態の遷移**: 完了は今の `canTransition`（in_progress → completed の一方通行。`ListStatus.ts`）を通す。取り消しは、`canTransition` に completed → in_progress を足さず、別の規則 `canRevert`（購入日時が入っていること）を `revertHistory.ts` に置く。取り消しは「完了の逆」ではなく購入日時の有無で決まる別の操作で、`canTransition` を双方向にすると完了の確認（進行中からだけ完了にできる）が弱まるため。ADR-002 の「一方通行」とのずれは design-doc 9 のとおり (5) で ADR を直す
- 理由の値と sync.push の conflict の reason の対応は sync の層で決める（`not_in_progress` → 今の `already_completed`、`not_completed` → `not_completed`。reason の文字列は変えない）。tRPC は `not_in_progress` を今と同じ `ShoppingDomainError`（BAD_REQUEST）に、取り消しの `not_completed` を NOT_FOUND（「履歴が見つかりません」）にする
- 除外の「どのリストが進行中で同じスコープか」はサーバーでは SQL の条件のまま残し、名前での除外だけ domain を使う。クライアントで使うとき（O8）は同じ条件の述語を domain に足す
- **所有スコープ**: `isSameScope` と型 `OwnerScope` を `src/infrastructure/db/ownership.ts` から `src/shared/domain/ownerScope.ts` に移す。ownership.ts は自分で使う分を shared から import するだけで、**再エクスポートしない**（#151 の方針。import の経路を 1 つにする）。使っている箇所（`routers/shopping.ts`、`catalog/application/services/ownership.ts`、`catalogItemScope.ts`、`SyncPushService.ts`、`sync/infrastructure/entityAccess.ts`、テスト）の import を shared に変える。`eslint.config.mjs` の no-restricted-imports に「`isSameScope`・`OwnerScope` は `@/shared/domain/ownerScope` から」を足し、ownership.ts の「src/shared には置かない」のコメントを「drizzle を使う判定はここ、純粋な判定は shared」に直す
- **domain の import の制限**: `eslint.config.mjs` に、`src/modules/*/domain/**` から `drizzle-orm`・`dexie`・`@trpc/*`・`@/infrastructure/*` を import しない no-restricted-imports を足す（#151 と同じやり方）。既存の違反（`ItemRepository.ts`・`TagRepository.ts`・`ShoppingListRepository.ts` の `DbExecutor`。design-doc 7.4）は、この change では `domain/repositories/**` を対象から外して残す

代替案: 照合を SQL の WHERE に残し、domain は「名前の一覧」だけを返す。→ スコープ・購入状態の規則が SQL とクライアントのフィルタに分かれたままになり、O8 でまたずれるので採らない。

### D3. サーバーの組み立て（application 層）

- 完了・取り消しの I/O の手順を `src/modules/shopping/application/services/` の関数（例: `applyFinishShopping(tx, listRow, at, opTime?)`・`applyRevertHistory(...)`）にまとめ、tRPC（`ShoppingService`）と sync.push（`SyncPushService`）の両方から呼ぶ。手順: リストの行をロック → リストの商品を読む → `plan*` → 候補を `name IN (...)` とスコープ・未削除で 1 回で読む → `select*` で選ぶ → id の一覧で 1 回で UPDATE（sync.push は `fieldNotNewerThan` を WHERE に足す）→ 外す商品を論理削除 → リストを更新
- **スコープの条件を落とさない（#73-1）**: tRPC では、リストの行をロックする SELECT（`FOR UPDATE`）の WHERE に `notDeleted` と `accessibleByUser(ctx.userId)` を付け、0 行なら今と同じエラー（完了は「リストが見つかりません」の BAD_REQUEST、取り消しは「履歴が見つかりません」の NOT_FOUND）にする。リストの UPDATE の WHERE にも同じ 2 つを残す。`canAccess` の後に権限が変わった場合のテストを置く。sync.push は今の `usable` の確認とロックのまま
- **書く id と記録する id**: カタログの UPDATE は `returning` した id を結果にし、tRPC はその id を今と同じく `sync_operations` に記録する（コミットの後）。sync.push は LWW の条件で UPDATE から外れた id を含めない。今の「名前ごとの UPDATE の returning」と同じ集合になることを、購入済み・別スコープ・削除済み・LWW で外れる商品を混ぜたテストで確かめる
- 名前ごとの UPDATE（N+1）が、候補の SELECT 1 回と UPDATE 1 回になる
- tRPC の取り消しは `ShoppingService.revertHistory` に移し、1 トランザクションにする。同期の記録は今と同じくコミットの後に書く
- 依存の向き: router（infrastructure）→ application → domain、domain → shared。sync の application が shopping の application を呼ぶのは今と同じ（7.5 の解消は Non-goals）。catalog の router が shopping の domain（除外）を使うのは、「買いたいもの」の一覧が shopping の状態に依存する読み取りのため。catalog の domain・application は shopping に依存しない

### D4. DB

スキーマ・migration・Dexie の version の変更はない。リリース手順への影響もない。

## Risks / Trade-offs

- [照合を「読んでから書く」にすると、読んだ後に別の処理が同じ商品を変えうる] → トランザクションの中でリストの行をロックしてから読む。カタログの商品の購入日時は、tRPC は後勝ち、sync.push は LWW の条件を UPDATE に残すので、今より悪くならない
- [リストの行のロックで防げるのは、同じリストをロックする処理（sync.push）との競合だけ] → tRPC の `checkItem`・`addItemToList` は親のリストをロックしないので、完了の読み込みの直後に tRPC でチェックが変わると、その変更は完了に入らない（今も同じ）。直すのは範囲外（router を薄くする (4) で扱う）
- [クライアントの hooks は古いまま] → O7/O8 で置き換える。それまでの間、ゲストの照合（名前だけ・スコープなし）はサーバーとずれたまま（今と同じ）

## Migration Plan

DB の変更がないので、通常の develop へのマージで出す。戻すときは revert でよい。
