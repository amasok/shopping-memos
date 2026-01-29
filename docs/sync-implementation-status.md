# 同期実装状況調査

## 概要

各画面の操作について、ローカル（IndexedDB）とサーバー（PostgreSQL）の実装状況を調査する。

### 凡例

- ✅ 実装済み
- ❌ 未実装
- ⚠️ 部分的に実装/要確認
- ➖ 対象外（ログイン時のみ/未ログイン時のみ）

---

## 1. ホーム画面 (/)

| 操作 | ローカル | サーバー | 備考 |
|------|---------|---------|------|
| アイテム一覧取得 | ✅ | ✅ | `useItems()` |
| アイテム作成 | ✅ | ✅ | `useItemMutations().createItem()` |
| アイテム更新 | ✅ | ✅ | `useItemMutations().updateItem()` |
| アイテム削除 | ✅ | ✅ | `useItemMutations().deleteItem()` |
| タグ一覧取得 | ✅ | ✅ | `useTags()` |
| タグ作成 | ✅ | ✅ | `useTagMutations().createTag()` - アイテム作成時 |
| リスト一覧取得 | ✅ | ✅ | `useListsWithItems()` |
| グループ一覧取得 | ➖ | ✅ | `useGroups()` - ログイン時のみ |
| グループ変更 | ➖ | ✅ | `setSelectedGroupId()` - ログイン時のみ |

---

## 2. リスト一覧画面 (/lists)

| 操作 | ローカル | サーバー | 備考 |
|------|---------|---------|------|
| リスト一覧取得 | ✅ | ✅ | `useLists()` |
| グループ変更 | ➖ | ✅ | `setSelectedGroupId()` - ログイン時のみ |

---

## 3. リスト作成画面 (/lists/new)

| 操作 | ローカル | サーバー | 備考 |
|------|---------|---------|------|
| アイテム一覧取得 | ✅ | ✅ | `useItems()` |
| タグ一覧取得 | ✅ | ✅ | `useTags()` |
| リスト作成 | ✅ | ✅ | `useListMutations().createList()` |
| 選択アイテム削除 | ✅ | ✅ | `useItemMutations().deleteItem()` |

---

## 4. 買い物中画面 (/lists/[id])

| 操作 | ローカル | サーバー | 備考 |
|------|---------|---------|------|
| リスト詳細取得 | ✅ | ✅ | `useList()` |
| リスト名更新 | ✅ | ✅ | `useListMutations().updateList()` |
| リスト削除 | ✅ | ✅ | `useListMutations().deleteList()` |
| アイテムチェック | ✅ | ✅ | `useListMutations().checkItem()` |
| アイテム追加（既存） | ✅ | ✅ | `useListMutations().addItemToList()` |
| アイテム追加（新規） | ✅ | ✅ | `useListMutations().addNewItemToList()` |
| アイテム削除 | ✅ | ✅ | `useListMutations().removeItemFromList()` |
| 買い物完了 | ✅ | ✅ | `useListMutations().finishShopping()` |
| タグ作成 | ✅ | ✅ | `useTagMutations().createTag()` |
| アイテム削除（カタログ） | ✅ | ✅ | `useItemMutations().deleteItem()` |

---

## 5. 購入履歴画面 (/history)

| 操作 | ローカル | サーバー | 備考 |
|------|---------|---------|------|
| 履歴一覧取得 | ✅ | ✅ | `useHistory()` |
| リストに戻す | ✅ | ✅ | `useHistoryMutations().revertHistory()` |
| 履歴削除 | ✅ | ✅ | `useHistoryMutations().deleteHistory()` |

---

## 6. タグ管理画面 (/tags)

| 操作 | ローカル | サーバー | 備考 |
|------|---------|---------|------|
| タグ一覧取得 | ✅ | ✅ | `useTags()` |
| タグ作成 | ✅ | ✅ | `useTagMutations().createTag()` |
| タグ更新 | ✅ | ✅ | `useTagMutations().updateTag()` |
| タグ削除 | ✅ | ✅ | `useTagMutations().deleteTag()` |

---

## 7. グループ管理画面 (/groups)

| 操作 | ローカル | サーバー | 備考 |
|------|---------|---------|------|
| グループ一覧取得 | ➖ | ✅ | `useGroups()` - ログイン時のみ |
| グループ作成 | ➖ | ✅ | `identity.createGroup` - ログイン時のみ |
| グループ参加 | ➖ | ✅ | `identity.joinByInviteCode` - ログイン時のみ |

---

## 8. グループ詳細画面 (/groups/[id])

| 操作 | ローカル | サーバー | 備考 |
|------|---------|---------|------|
| グループ詳細取得 | ➖ | ✅ | `useGroup()` - ログイン時のみ |
| グループ名更新 | ➖ | ✅ | `identity.updateGroup` - ログイン時のみ |
| 招待コード再生成 | ➖ | ✅ | `identity.regenerateInviteCode` - ログイン時のみ |
| メンバー削除 | ➖ | ✅ | `identity.removeMember` - ログイン時のみ |
| グループ削除 | ➖ | ✅ | `identity.deleteGroup` - ログイン時のみ |
| グループ退出 | ➖ | ✅ | `identity.removeMember` - ログイン時のみ |

---

## 調査結果サマリー

### 未実装/要修正項目

なし（全て修正済み）

### 実装済み項目

ほぼ全ての操作がローカル/サーバー両方で実装済み。
グループ関連機能はログイン時のみ動作する設計のため、ローカル実装は不要（対象外）。

### 注意事項

1. **サーバーファーストの動作**: ログイン時はサーバーAPI経由、未ログイン時はローカルDB直接操作
2. **グループ機能**: グループはサーバーサイドのみの機能（IndexedDBにはグループ概念なし）
3. **データ分離**: グループ選択時は該当グループのデータのみ表示、個人モード（グループなし）では個人データを表示

---

## アーキテクチャメモ

### 購入履歴の管理方式

`purchase_history` テーブルは廃止され、`shopping_lists.purchased_at` で購入履歴を管理する方式に変更。

| 状態 | 条件 |
|------|------|
| 進行中リスト | `purchased_at = NULL` かつ `status = 'in_progress'` |
| 完了済リスト | `purchased_at = NULL` かつ `status = 'completed'` |
| 購入履歴 | `purchased_at IS NOT NULL` |

**操作:**
- **買い物完了**: `shopping_lists.purchased_at` に日時を設定、関連する `items.purchased_at` も設定
- **リストに戻す**: `shopping_lists.purchased_at` を NULL に、関連する `items.purchased_at` も NULL に
- **履歴削除**: `shopping_lists`、`list_items`、関連する `items` を削除
