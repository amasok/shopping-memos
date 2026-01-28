# ADR-002: 境界づけられたコンテキスト

## ステータス

**承認済み**

## コンテキスト

買い物メモアプリのドメインを適切に分割し、責務を明確にする必要がある。

### 現状のデータモデル

Dexieで以下のエンティティが実装済み:
- `Tag` - タグ
- `ShoppingItem` - 買いたいもの
- `ShoppingList` - 買い物リスト
- `ListItem` - リスト内アイテム
- `PurchaseHistory` - 購入履歴
- `Group` - グループ
- `GroupMember` - グループメンバー

### 課題

1. すべてのエンティティがフラットに配置されている
2. エンティティ間の依存関係が不明確
3. コードが肥大化した際の保守性への懸念

## 検討した選択肢

### 1. モノリシック（分割なし）

```
src/
├── entities/
│   ├── Item.ts
│   ├── Tag.ts
│   ├── List.ts
│   └── ...
├── services/
│   └── ShoppingService.ts
└── repositories/
    └── ...
```

**メリット**:
- シンプル
- 現状のコード構造に近い

**デメリット**:
- 規模拡大時に破綻
- 責務の境界が曖昧

### 2. 機能別分割

```
src/modules/
├── items/
├── tags/
├── lists/
├── history/
└── groups/
```

**メリット**:
- 直感的
- 画面との対応が明確

**デメリット**:
- クロス機能の配置が難しい
- ドメインの本質を捉えていない

### 3. 境界づけられたコンテキスト（DDD）

```
src/modules/
├── identity/     # 認証・認可・グループ
├── catalog/      # 買いたいもの・タグ
└── shopping/     # 買い物リスト・履歴
```

**メリット**:
- ドメインの本質に基づく分割
- 独立した進化が可能
- テストが容易

**デメリット**:
- 初期設計コスト
- コンテキスト間の連携が必要

## 決定

**3つの境界づけられたコンテキストに分割する**

```
┌─────────────────┬─────────────────┬─────────────────────────────┐
│    Identity     │     Catalog     │         Shopping            │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ - User          │ - Item          │ - ShoppingList              │
│ - Group         │ - Tag           │ - ListItem                  │
│ - GroupMember   │                 │ - PurchaseHistory           │
│ - InviteLink    │                 │                             │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ 認証・認可      │ マスタデータ    │ トランザクション            │
│ メンバー管理    │ 買いたいもの    │ 買い物フロー                │
└─────────────────┴─────────────────┴─────────────────────────────┘
```

## 理由

### 1. Identity コンテキスト

**責務**: 「誰が」「どのグループで」操作するかを管理

| エンティティ | 役割 |
|-------------|------|
| User | ユーザー情報（NextAuthから取得） |
| Group | 共有グループ |
| GroupMember | メンバーシップ（owner/member） |
| InviteLink | 招待リンク（7日有効、1回限り） |

**選定理由**:
- 認証・認可は他のドメインから独立
- グループ機能は「共有」の基盤
- セキュリティ上の関心事を集約

**インバリアント（ビジネスルール）**:
- グループには必ず1人以上のownerが必要
- 招待リンクは有効期限内かつ未使用でなければ無効
- ユーザーは同じグループに2回参加できない

### 2. Catalog コンテキスト

**責務**: 「何を」買いたいかを管理（マスタデータ）

| エンティティ | 役割 |
|-------------|------|
| Item | 買いたいもの（名前、数量、メモ） |
| Tag | タグ（分類用ラベル） |

**選定理由**:
- 買いたいものは「ストック」として永続化
- タグはアイテムを分類するメタデータ
- 買い物リストとは独立したライフサイクル

**インバリアント**:
- アイテム名は1〜100文字
- 数量は1以上の整数
- 1つのアイテムは1つのグループにのみ所属（または個人）

### 3. Shopping コンテキスト

**責務**: 買い物フローを管理（トランザクション）

| エンティティ | 役割 |
|-------------|------|
| ShoppingList | 買い物リスト |
| ListItem | リスト内アイテム（スナップショット） |
| PurchaseHistory | 購入履歴 |

**選定理由**:
- 買い物リストは一時的なトランザクション
- ListItemはCatalog.Itemのスナップショット（編集されても履歴に影響しない）
- 履歴は「いつ、どこで、何を買ったか」の記録

**インバリアント**:
- リストのステータスは `in_progress` → `completed` の一方通行
- 購入完了時、チェックされたアイテムのみ履歴に記録
- 未チェックのアイテムはCatalog.Itemに戻る

## コンテキスト間の関係

### 依存関係

```
Identity ─────────────────────────────────────┐
    │                                         │
    │ groupId                                 │ groupId
    ↓                                         ↓
Catalog ←──── itemId/tagIds ───→ Shopping
```

- **Identity → Catalog/Shopping**: groupIdによるスコープ
- **Catalog → Shopping**: アイテムがListItemにコピー（参照ではなくスナップショット）
- **Shopping → Catalog**: 未購入アイテムはCatalogに戻る

### コンテキスト間の連携パターン

#### 1. グループスコープ（Identity → Catalog/Shopping）

```typescript
// Catalog: アイテム取得時にgroupIdでフィルタ
const result = await db
  .select()
  .from(items)
  .where(eq(items.groupId, currentGroupId))

// Shopping: リスト作成時にgroupIdを継承
await db.insert(shoppingLists).values({
  id: generateId(),
  name: 'スーパーA',
  groupId: currentGroupId,  // グループに紐付け
})
```

#### 2. アイテムのスナップショット（Catalog → Shopping）

```typescript
// リスト作成時、Catalog.ItemをListItemにコピー
function createListFromItems(items: Item[], listId: string): ListItem[] {
  return items.map(item => ({
    id: generateId(),
    listId,
    name: item.name,          // スナップショット
    quantity: item.quantity,  // スナップショット
    memo: item.memo,          // スナップショット
    tagIds: item.tagIds,      // スナップショット
    groupId: item.groupId,
    checked: false,
    createdAt: new Date(),
  }))
}
```

**スナップショットの理由**:
- 後からItem.nameを編集しても、過去のリスト/履歴には影響しない
- 履歴の正確性を保証

#### 3. 未購入アイテムの復帰（Shopping → Catalog）

```typescript
// 買い物完了時の処理
async function finishShopping(listId: string, location?: string) {
  const list = await getListWithItems(listId)
  const checkedItems = list.items.filter(i => i.checked)
  const uncheckedItems = list.items.filter(i => !i.checked)

  // 1. チェック済みアイテムを履歴に記録
  await createPurchaseHistory({
    listId,
    location,
    itemIds: checkedItems.map(i => i.id),
    purchasedAt: new Date(),
  })

  // 2. 未チェックアイテムはそのまま残る（Catalogに戻る処理は不要）
  //    → Catalog.Itemはリスト作成時に削除していないため

  // 3. リストを完了
  await updateList(listId, { status: 'completed', completedAt: new Date() })
}
```

## ディレクトリ構造

```
src/modules/
├── identity/
│   ├── domain/
│   │   ├── entities/
│   │   │   ├── User.ts
│   │   │   ├── Group.ts
│   │   │   ├── GroupMember.ts
│   │   │   └── InviteLink.ts
│   │   └── value-objects/
│   │       └── Role.ts
│   ├── application/
│   │   ├── commands/
│   │   │   ├── CreateGroup.ts
│   │   │   ├── InviteMember.ts
│   │   │   └── AcceptInvite.ts
│   │   └── queries/
│   │       ├── GetUserGroups.ts
│   │       └── GetGroupMembers.ts
│   └── infrastructure/
│       └── repositories/
│           └── GroupRepository.ts
│
├── catalog/
│   ├── domain/
│   │   ├── entities/
│   │   │   ├── Item.ts
│   │   │   └── Tag.ts
│   │   └── value-objects/
│   │       └── Quantity.ts
│   ├── application/
│   │   ├── commands/
│   │   │   ├── CreateItem.ts
│   │   │   ├── UpdateItem.ts
│   │   │   └── DeleteItem.ts
│   │   └── queries/
│   │       ├── GetItems.ts
│   │       └── GetTags.ts
│   └── infrastructure/
│       └── repositories/
│           ├── ItemRepository.ts
│           └── TagRepository.ts
│
└── shopping/
    ├── domain/
    │   ├── entities/
    │   │   ├── ShoppingList.ts
    │   │   ├── ListItem.ts
    │   │   └── PurchaseHistory.ts
    │   ├── value-objects/
    │   │   └── ListStatus.ts
    │   └── services/
    │       └── ShoppingService.ts
    ├── application/
    │   ├── commands/
    │   │   ├── CreateList.ts
    │   │   ├── FinishShopping.ts
    │   │   └── RevertHistory.ts
    │   └── queries/
    │       ├── GetActiveLists.ts
    │       └── GetPurchaseHistory.ts
    └── infrastructure/
        └── repositories/
            ├── ShoppingListRepository.ts
            └── PurchaseHistoryRepository.ts
```

## 影響

### ポジティブ
- 各コンテキストが独立してテスト可能
- 責務が明確で保守性が向上
- チーム開発時にコンテキストごとに分担可能（将来）

### ネガティブ
- 初期実装コストがやや高い
- コンテキスト間の連携コード（Anti-Corruption Layer）が必要

### 対策
- 最初は薄いレイヤーから始める
- 複雑になってきたらドメインサービスを追加

## 参考資料

- Eric Evans, "Domain-Driven Design: Tackling Complexity in the Heart of Software"
- [Martin Fowler - BoundedContext](https://martinfowler.com/bliki/BoundedContext.html)
