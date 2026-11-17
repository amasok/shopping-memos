# Proposal: カタログ（商品・タグ）をローカルファーストに移す（#62 O7）

Issue: #62（https://github.com/amasok/shopping-memos/issues/62）の O7。設計の正は `docs/features/offline-support.md`（#62 が終わるまで）

## Why

O6 で同期エンジン（push / pull）とユーザーごとの DB はできたが、画面はまだ tRPC だけを読み書きしている（`useDataSource` はフラグを見ていない）。オフラインでも商品とタグを見て編集できるように、カタログの読み書きを端末の DB とリポジトリ経由にする。O8（買い物）・O9（セッション・同期の UI）と一緒に R3 で出す。

## What Changes

- カタログの読み書きの経路を、モードで 1 つに決める（`useCatalogSource`）
  - ゲスト: 端末のゲスト DB。リポジトリ経由で書き、同期のキューには積まない（今と同じ DB）
  - ログイン中でフラグ `NEXT_PUBLIC_LOCAL_FIRST` が false: 今の tRPC のまま
  - ログイン中でフラグが true（merge 済み）: ユーザー DB（`ShoppingMemosDB-u-<userId>`）を読み、書き込みは同じトランザクションで同期のキューに積み、2 秒のデバウンスで同期する
- `LocalCatalogRepository`（`src/infrastructure/local/catalogRepository.ts`）を足し、`useItemMutations` / `useTagMutations` の端末側の書き込みをそこに集める。タグの削除は、アイテムの `tagIds` からも外す（1 トランザクション）。ゲストの更新でも `updatedAt` を更新する（今は更新していない）
- `useItems` / `useTags` のローカルファーストの読み取り: 絞り込みと進行中のリストの除外は #179 の domain の関数（`excludeItemsInActiveLists`）を使い、並びはサーバーと同じにする（アイテムは作成の古い順、タグは名前順）。初回の同期が終わるまでは「読み込み中」にする
- ローカルファーストでは、買い物（tRPC のまま。O8 で移す）の変更の後に同期して、「買いたいもの」の除外を追いつかせる
- 同期エンジンが pull のたびに `identity.getGroups` で `groups` のキャッシュを上書きし、ローカルファーストの `useGroups` はキャッシュを読む（オフラインでもグループを切り替えられる）
- `app/groups/page.tsx` の、グループの作成・参加の後にゲスト DB へ書いている処理をやめる（ログイン中はどこからも読まれていない）
- `docs/features/offline-support.md` の、O7 に関わる実装とのずれ（design-doc 7.9: ローカルファーストの範囲・フラグの既定・O7 の範囲・同期のきっかけ）を直す

## Capabilities

### New Capabilities

- `catalog`: 商品とタグの一覧・作成・更新・削除を、ゲスト・サーバーファースト・ローカルファーストのどのモードで、どこに読み書きするか。この change で、触れる範囲の今の振る舞い（一覧の絞り込み）も書き起こす
- `sync`: 端末の同期。この change では所属グループのキャッシュと、初回の同期の扱いだけを書く（push・pull の本体の spec は、触れる change で書き起こす）

### Modified Capabilities

- なし（`shopping` の「買いたいもの」の除外の Requirement は変えない。ローカルファーストでも同じ規則を端末の DB に当てる）

## 影響するモード

| モード | 影響 |
|-------|------|
| ゲスト | 書き込みがリポジトリ経由になる（見える結果は同じ。`updatedAt` が更新されるようになる） |
| サーバーファースト（フラグ false。本番の今の状態） | 変わらない。`app/groups/page.tsx` のゲスト DB への書き込みをやめる（どこからも読まれていないので見える結果は同じ） |
| ローカルファースト（フラグ true） | カタログの読み書きと `useGroups` が端末の DB を使う。本番ではまだ有効にしない（R3） |

## Non-goals

- 買い物（lists / listItems / history）の移行（O8）
- オフラインのセッション・同期の状態の UI・ログアウト時のユーザー DB の削除・グループのメンバー一覧のキャッシュ（O9）
- `lib/db` の型を domain の型にそろえること（範囲が大きいので後に回す）
- ゲストとログイン中の一覧の並びをそろえること、`app/items/new/page.tsx` の直し（ユーザーの判断が要るので、保留の change `62-o7b-catalog-guest-alignment` に分けた）
- フラグを true にした E2E（O9 で、オフラインのセッションと一緒に足す）

## Impact

- 追加: `src/infrastructure/local/catalogRepository.ts`、`src/hooks/data/useCatalogSource.ts`、`src/hooks/data/catalogQueries.ts`（端末の DB の読み取り）
- 変更: `src/hooks/data/useItems.ts`・`useTags.ts`・`useItemMutations.ts`・`useTagMutations.ts`・`useGroups.ts`・`useListMutations.ts`・`useHistoryMutations.ts`（invalidate の代わりの同期だけ）、`src/infrastructure/sync/SyncEngine.ts`（グループのキャッシュ）、`src/contexts/SyncContext.tsx`（transport に `getGroups`）、`src/app/groups/page.tsx`、`docs/features/offline-support.md`・`docs/design-doc.md`（7.9）
- API・DB の migration・Dexie の version: 変更なし（`groups` テーブルは v10 にある。キャッシュの行に `memberCount` を足すが、インデックスではないので version は上げない）

## ユーザーに確認すること

なし（確認が要るものは `62-o7b-catalog-guest-alignment` に分けた。リーダーの指示、2026-11-17）。
