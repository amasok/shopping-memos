# バックエンドアーキテクチャ設計書

## 1. 概要

買い物メモアプリのバックエンドアーキテクチャを定義する。オフラインファーストPWAとしてのローカルDB（Dexie/IndexedDB）と、ログイン後のサーバー同期（PostgreSQL）を両立させる設計。

### 1.1 設計原則

| 原則 | 説明 |
|------|------|
| オフラインファースト | ローカル操作は即時反映。サーバーは同期先 |
| 型安全性 | TypeScript + Zod + tRPC でエンドツーエンド型安全 |
| 軽量DDD | 境界づけられたコンテキストで関心を分離 |
| 軽量CQRS | Command はドメイン経由、Query は直接取得 |

### 1.2 現状

| レイヤー | 技術 | 状態 |
|---------|------|------|
| フロントエンド | Next.js 16 + React 19 | 実装済み |
| ローカルDB | Dexie (IndexedDB) | 実装済み |
| 認証 | NextAuth | 設定予定 |
| サーバーDB | PostgreSQL (Drizzle ORM) | スキーマ定義予定 |
| API | 未実装 | tRPC + Server Actions 予定 |

### 1.3 技術選定理由

**Drizzle ORMを採用する理由**:
- SQLライクなクエリビルダーでCQRSのQuery側に最適
- DDDフレンドリー（リポジトリパターンと自然に組み合わせ可能）
- エンティティとDBスキーマを明示的に分離
- 軽量で高速

---

## 2. システム構成

### 2.1 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Client (PWA)                              │
├─────────────────────────────────────────────────────────────────────┤
│  React Components ←→ Context/Hooks ←→ Dexie (IndexedDB)            │
│                              ↓                                      │
│                       Sync Engine                                   │
│                              ↓                                      │
├─────────────────────────────────────────────────────────────────────┤
│                         Network                                     │
├─────────────────────────────────────────────────────────────────────┤
│                       Next.js Server                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     tRPC Router                              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │   │
│  │  │  Identity   │  │   Catalog   │  │      Shopping       │  │   │
│  │  │   Router    │  │   Router    │  │       Router        │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │   │
│  └─────────┼────────────────┼────────────────────┼─────────────┘   │
│            ↓                ↓                    ↓                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   Application Layer                          │   │
│  │         Commands / Queries / Use Cases                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              ↓                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     Domain Layer                             │   │
│  │         Entities / Value Objects / Services                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              ↓                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                 Infrastructure Layer                         │   │
│  │     Drizzle ORM / NextAuth / Sync Engine / Repositories      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              ↓                                      │
│                  PostgreSQL (Vercel Postgres / Neon)                │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 データフロー

#### ゲストモード（未ログイン）

```
User Action → React Component → Context Hook → Dexie → IndexedDB
                                      ↓
                              UI Update (Optimistic)
```

#### ログイン後

```
User Action → React Component → Context Hook → Dexie → IndexedDB
                                      ↓
                              UI Update (Optimistic)
                                      ↓
                              Sync Engine (Background)
                                      ↓
                              tRPC Mutation → PostgreSQL
```

---

## 3. 境界づけられたコンテキスト

### 3.1 コンテキスト概要

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

### 3.2 Identity コンテキスト

**責務**: 認証、認可、グループ管理

| エンティティ | 説明 |
|-------------|------|
| User | ユーザー情報（NextAuthから） |
| Group | 共有グループ |
| GroupMember | グループメンバーシップ（役割: owner/member） |
| InviteLink | 招待リンク（7日有効、1回限り） |

**主要ユースケース**:
- ログイン / ログアウト
- グループ作成 / 編集 / 削除
- メンバー招待 / 承認 / 削除

### 3.3 Catalog コンテキスト

**責務**: 買いたいもの、タグのマスタ管理

| エンティティ | 説明 |
|-------------|------|
| Item | 買いたいもの（名前、数量、メモ） |
| Tag | タグ（分類用ラベル） |

**主要ユースケース**:
- アイテム CRUD
- タグ CRUD
- タグ付け / タグ外し
- グループ紐付け

### 3.4 Shopping コンテキスト

**責務**: 買い物フロー、履歴管理

| エンティティ | 説明 |
|-------------|------|
| ShoppingList | 買い物リスト |
| ListItem | リスト内アイテム（スナップショット） |
| PurchaseHistory | 購入履歴 |

**主要ユースケース**:
- リスト作成（タグ選択 → アイテム選択）
- 買い物実行（カゴ入れ → 購入完了）
- 履歴閲覧 / リストに戻す

### 3.5 コンテキスト間の関係

```
Identity ─────────────────────────────────────┐
    │                                         │
    │ groupId                                 │ groupId
    ↓                                         ↓
Catalog ←──── itemId/tagIds ───→ Shopping
    │                                │
    │                                │
    └──────── Item参照 ─────────────→ ListItem（スナップショット）
```

- **Identity → Catalog/Shopping**: グループIDによるスコープ
- **Catalog → Shopping**: アイテムがListItemにコピー（スナップショット）
- **Shopping → Catalog**: 未購入アイテムはCatalogに戻る

---

## 4. CQRS 実装方針

### 4.1 概要

| 責務 | 経路 | 用途 |
|------|------|------|
| Command | Domain Entity → Repository | 書き込み（バリデーション + ビジネスルール） |
| Query | Repository → DTO | 読み取り（パフォーマンス優先） |

### 4.2 Command 例

```typescript
// src/modules/catalog/application/commands/CreateItem.ts
export class CreateItemCommand {
  constructor(
    public readonly name: string,
    public readonly quantity: number,
    public readonly memo: string | undefined,
    public readonly tagIds: string[],
    public readonly groupId: string | undefined,
  ) {}
}

export class CreateItemHandler {
  constructor(private readonly itemRepository: ItemRepository) {}

  async execute(command: CreateItemCommand): Promise<Item> {
    // 1. ドメインエンティティを生成（バリデーション）
    const item = Item.create({
      name: command.name,
      quantity: command.quantity,
      memo: command.memo,
      tagIds: command.tagIds,
      groupId: command.groupId,
    })

    // 2. 永続化
    await this.itemRepository.save(item)

    return item
  }
}
```

### 4.3 Query 例

```typescript
// src/modules/catalog/application/queries/GetItems.ts
export class GetItemsQuery {
  constructor(
    public readonly groupId: string | undefined,
    public readonly tagIds: string[] | undefined,
    public readonly searchText: string | undefined,
  ) {}
}

export class GetItemsHandler {
  constructor(private readonly db: DrizzleDB) {}

  async execute(query: GetItemsQuery): Promise<ItemDTO[]> {
    // Drizzleで直接クエリ（パフォーマンス優先）
    const conditions = [isNull(items.purchasedAt)]

    if (query.groupId) {
      conditions.push(eq(items.groupId, query.groupId))
    }
    if (query.searchText) {
      conditions.push(ilike(items.name, `%${query.searchText}%`))
    }

    const result = await this.db
      .select()
      .from(items)
      .leftJoin(itemTags, eq(items.id, itemTags.itemId))
      .leftJoin(tags, eq(itemTags.tagId, tags.id))
      .where(and(...conditions))
      .orderBy(desc(items.createdAt))

    // DTOに変換して返す
    return this.toDTO(result)
  }
}
```

### 4.4 Event Sourcing

**採用しない**。理由:
- 買い物メモアプリでは過剰な複雑性
- 履歴はPurchaseHistoryで十分
- 操作ログは同期用SyncOperationテーブルで管理

---

## 5. ディレクトリ構造

```
src/
├── app/                          # Next.js App Router
│   ├── api/
│   │   └── trpc/[trpc]/route.ts  # tRPCエンドポイント
│   ├── (auth)/                   # 認証関連ページ
│   └── (main)/                   # メイン画面
│
├── modules/                      # DDDモジュール
│   ├── identity/                 # Identityコンテキスト
│   │   ├── domain/
│   │   │   ├── entities/
│   │   │   │   ├── User.ts
│   │   │   │   ├── Group.ts
│   │   │   │   ├── GroupMember.ts
│   │   │   │   └── InviteLink.ts
│   │   │   └── value-objects/
│   │   │       └── Role.ts
│   │   ├── application/
│   │   │   ├── commands/
│   │   │   │   ├── CreateGroup.ts
│   │   │   │   ├── InviteMember.ts
│   │   │   │   └── AcceptInvite.ts
│   │   │   └── queries/
│   │   │       ├── GetUserGroups.ts
│   │   │       └── GetGroupMembers.ts
│   │   └── infrastructure/
│   │       └── repositories/
│   │           ├── GroupRepository.ts
│   │           └── InviteLinkRepository.ts
│   │
│   ├── catalog/                  # Catalogコンテキスト
│   │   ├── domain/
│   │   │   ├── entities/
│   │   │   │   ├── Item.ts
│   │   │   │   └── Tag.ts
│   │   │   └── value-objects/
│   │   │       └── Quantity.ts
│   │   ├── application/
│   │   │   ├── commands/
│   │   │   │   ├── CreateItem.ts
│   │   │   │   ├── UpdateItem.ts
│   │   │   │   ├── DeleteItem.ts
│   │   │   │   ├── CreateTag.ts
│   │   │   │   └── DeleteTag.ts
│   │   │   └── queries/
│   │   │       ├── GetItems.ts
│   │   │       ├── GetTags.ts
│   │   │       └── SearchItems.ts
│   │   └── infrastructure/
│   │       └── repositories/
│   │           ├── ItemRepository.ts
│   │           └── TagRepository.ts
│   │
│   └── shopping/                 # Shoppingコンテキスト
│       ├── domain/
│       │   ├── entities/
│       │   │   ├── ShoppingList.ts
│       │   │   ├── ListItem.ts
│       │   │   └── PurchaseHistory.ts
│       │   ├── value-objects/
│       │   │   └── ListStatus.ts
│       │   └── services/
│       │       └── ShoppingService.ts
│       ├── application/
│       │   ├── commands/
│       │   │   ├── CreateList.ts
│       │   │   ├── AddItemToList.ts
│       │   │   ├── CheckItem.ts
│       │   │   ├── FinishShopping.ts
│       │   │   └── RevertHistory.ts
│       │   └── queries/
│       │       ├── GetActiveLists.ts
│       │       ├── GetListItems.ts
│       │       └── GetPurchaseHistory.ts
│       └── infrastructure/
│           └── repositories/
│               ├── ShoppingListRepository.ts
│               └── PurchaseHistoryRepository.ts
│
├── shared/                       # 共有レイヤー
│   ├── schemas/                  # Zodスキーマ
│   │   ├── item.ts
│   │   ├── tag.ts
│   │   ├── list.ts
│   │   └── group.ts
│   ├── types/
│   │   └── index.ts
│   └── utils/
│       └── id.ts
│
├── infrastructure/               # インフラ層
│   ├── db/
│   │   ├── drizzle/              # Drizzle ORM
│   │   │   ├── client.ts         # DBクライアント
│   │   │   ├── schema.ts         # スキーマ定義
│   │   │   └── migrations/       # マイグレーション
│   │   └── dexie/                # 既存Dexie
│   │       └── index.ts
│   ├── auth/
│   │   └── nextauth.ts           # NextAuth設定
│   ├── trpc/
│   │   ├── server.ts             # tRPCサーバー設定
│   │   ├── client.ts             # tRPCクライアント
│   │   └── routers/
│   │       ├── index.ts
│   │       ├── identity.ts
│   │       ├── catalog.ts
│   │       └── shopping.ts
│   └── sync/                     # 同期エンジン
│       ├── SyncEngine.ts
│       ├── SyncOperation.ts
│       └── ConflictResolver.ts
│
├── components/                   # 既存UIコンポーネント
├── contexts/                     # 既存Reactコンテキスト
└── lib/                          # 既存ユーティリティ
    └── db/                       # 既存Dexie操作
```

---

## 6. データモデル

### 6.1 Dexie（ローカル）スキーマ

現在実装済み。変更なし。

```typescript
// 既存: src/lib/db/index.ts
interface Tag { id, name, groupId?, createdAt, updatedAt }
interface ShoppingItem { id, name, quantity, memo?, tagIds[], groupId?, purchasedAt?, createdAt, updatedAt }
interface ShoppingList { id, name, status, groupId?, createdAt, completedAt? }
interface ListItem { id, listId, name, quantity, memo?, tagIds[], groupId?, checked, createdAt }
interface PurchaseHistory { id, listId, location?, itemIds[], groupId?, purchasedAt }
interface Group { id, name, ownerId, inviteCode?, createdAt, updatedAt }
interface GroupMember { id, groupId, userId, userName, userEmail, role, joinedAt }
```

### 6.2 Drizzle（サーバー）スキーマ

```typescript
// src/infrastructure/db/drizzle/schema.ts
import { pgTable, text, integer, boolean, timestamp, primaryKey, index } from 'drizzle-orm/pg-core'

// === Identity コンテキスト ===

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified'),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const accounts = pgTable('accounts', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  refreshToken: text('refresh_token'),
  accessToken: text('access_token'),
  expiresAt: integer('expires_at'),
  tokenType: text('token_type'),
  scope: text('scope'),
  idToken: text('id_token'),
  sessionState: text('session_state'),
}, (table) => ({
  pk: primaryKey({ columns: [table.provider, table.providerAccountId] }),
}))

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires').notNull(),
})

export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const groupMembers = pgTable('group_members', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),  // 'owner' | 'member'
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, (table) => ({
  uniqueGroupUser: index('group_user_idx').on(table.groupId, table.userId),
}))

export const inviteLinks = pgTable('invite_links', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// === Catalog コンテキスト ===

export const items = pgTable('items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  quantity: integer('quantity').notNull().default(1),
  memo: text('memo'),
  groupId: text('group_id').references(() => groups.id, { onDelete: 'set null' }),
  purchasedAt: timestamp('purchased_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  groupIdx: index('items_group_idx').on(table.groupId),
  purchasedIdx: index('items_purchased_idx').on(table.purchasedAt),
}))

export const tags = pgTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  groupId: text('group_id').references(() => groups.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  groupIdx: index('tags_group_idx').on(table.groupId),
}))

export const itemTags = pgTable('item_tags', {
  itemId: text('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.itemId, table.tagId] }),
}))

// === Shopping コンテキスト ===

export const shoppingLists = pgTable('shopping_lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('in_progress'),  // 'in_progress' | 'completed'
  groupId: text('group_id').references(() => groups.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  groupIdx: index('lists_group_idx').on(table.groupId),
  statusIdx: index('lists_status_idx').on(table.status),
}))

export const listItems = pgTable('list_items', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull().references(() => shoppingLists.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  quantity: integer('quantity').notNull().default(1),
  memo: text('memo'),
  tagIds: text('tag_ids').array(),  // スナップショット（正規化しない）
  groupId: text('group_id'),
  checked: boolean('checked').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  listIdx: index('list_items_list_idx').on(table.listId),
}))

export const purchaseHistory = pgTable('purchase_history', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull().unique().references(() => shoppingLists.id, { onDelete: 'cascade' }),
  location: text('location'),
  itemIds: text('item_ids').array(),  // 購入したアイテムのID
  groupId: text('group_id'),
  purchasedAt: timestamp('purchased_at').defaultNow().notNull(),
}, (table) => ({
  groupIdx: index('history_group_idx').on(table.groupId),
  purchasedIdx: index('history_purchased_idx').on(table.purchasedAt),
}))

// === 同期エンジン ===

export const syncOperations = pgTable('sync_operations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  entity: text('entity').notNull(),  // 'item' | 'tag' | 'list' | 'listItem' | 'history'
  entityId: text('entity_id').notNull(),
  operation: text('operation').notNull(),  // 'create' | 'update' | 'delete'
  payload: text('payload').notNull(),  // JSON文字列
  localId: text('local_id'),  // ローカルUUID
  syncedAt: timestamp('synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userSyncIdx: index('sync_user_idx').on(table.userId, table.syncedAt),
  entityIdx: index('sync_entity_idx').on(table.entity, table.entityId),
}))
```

### 6.3 リポジトリ実装例

```typescript
// src/modules/catalog/infrastructure/repositories/ItemRepository.ts
import { eq } from 'drizzle-orm'
import { db } from '@/infrastructure/db/drizzle/client'
import { items, itemTags } from '@/infrastructure/db/drizzle/schema'
import { Item } from '../../domain/entities/Item'

export class DrizzleItemRepository implements ItemRepository {
  async save(item: Item): Promise<void> {
    await db.transaction(async (tx) => {
      // 1. アイテムを保存
      await tx.insert(items).values({
        id: item.id,
        name: item.name,
        quantity: item.quantity.value,
        memo: item.memo,
        groupId: item.groupId,
        purchasedAt: item.purchasedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }).onConflictDoUpdate({
        target: items.id,
        set: {
          name: item.name,
          quantity: item.quantity.value,
          memo: item.memo,
          groupId: item.groupId,
          purchasedAt: item.purchasedAt,
          updatedAt: item.updatedAt,
        },
      })

      // 2. タグの関連を更新
      await tx.delete(itemTags).where(eq(itemTags.itemId, item.id))
      if (item.tagIds.length > 0) {
        await tx.insert(itemTags).values(
          item.tagIds.map(tagId => ({ itemId: item.id, tagId }))
        )
      }
    })
  }

  async findById(id: string): Promise<Item | null> {
    const result = await db
      .select()
      .from(items)
      .leftJoin(itemTags, eq(items.id, itemTags.itemId))
      .where(eq(items.id, id))

    if (result.length === 0) return null

    const itemRecord = result[0].items
    const tagIds = result.map(r => r.item_tags?.tagId).filter(Boolean) as string[]

    return Item.reconstitute({
      ...itemRecord,
      tagIds,
    })
  }

  async delete(id: string): Promise<void> {
    await db.delete(items).where(eq(items.id, id))
  }
}
```

---

## 7. 同期戦略

### 7.1 概要

```
IndexedDB (Dexie) ←→ Sync Engine ←→ PostgreSQL (Server)
```

- **ローカル優先**: すべての操作はまずDexieに書き込み
- **バックグラウンド同期**: オンライン時にサーバーと同期
- **競合解決**: Last Write Wins（最後の書き込みが勝つ）

### 7.2 同期フロー

#### 初回ログイン（データマージ）

```
1. ローカルデータを収集
   - items, tags, lists, listItems, history

2. サーバーにアップロード
   POST /api/sync/merge
   {
     items: [...],
     tags: [...],
     ...
   }

3. サーバーでマージ
   - 同名アイテムは重複として追加（ユーザーが後で整理）
   - ローカルIDをサーバーIDにマッピング

4. マッピング結果を受信
   {
     items: { localId: serverId, ... },
     ...
   }

5. ローカルDBのIDを更新
6. 以降はサーバーIDを使用
```

#### 通常同期

```
1. 操作発生
   - Dexieに書き込み
   - SyncQueueに追加（ローカル）

2. オンライン検出
   - navigator.onLine または定期チェック

3. 差分送信
   POST /api/sync/push
   {
     operations: [
       { entity: "item", operation: "create", payload: {...} },
       ...
     ]
   }

4. サーバーで処理
   - 各操作をトランザクションで実行
   - 競合検出（updatedAt比較）

5. 結果受信
   - 成功: ローカルのsyncedAtを更新
   - 競合: Last Write Winsで解決
```

### 7.3 競合解決

| シナリオ | 解決方法 |
|---------|---------|
| 同時編集 | Last Write Wins（updatedAt比較） |
| 削除 vs 編集 | 削除を優先 |
| 重要操作 | 確認ダイアログを表示（Phase 2） |

---

## 8. 実装フェーズ

### Phase 1: 基盤構築

- [ ] Zod導入 + 共有スキーマ定義
- [ ] tRPC基本設定
- [ ] Drizzleスキーマ定義 + マイグレーション
- [ ] ディレクトリ構造の作成

### Phase 2: Identity + 同期基盤

- [ ] NextAuth + Google認証（Drizzle Adapter）
- [ ] グループCRUD API
- [ ] 同期エンジン基盤
- [ ] ログイン時のデータマージ

### Phase 3: Catalog コンテキスト

- [ ] Item / Tag CRUD API
- [ ] グループスコープフィルタリング
- [ ] Dexie ↔ Server 同期

### Phase 4: Shopping コンテキスト

- [ ] List / ListItem API
- [ ] 買い物完了フロー
- [ ] 購入履歴
- [ ] Dexie ↔ Server 同期

---

## 9. セキュリティガイドライン

実装時に必ず以下のセキュリティ対策を適用すること。

### 9.1 認可チェック（必須）

すべてのAPI操作で、ユーザーが対象リソースにアクセスする権限を確認する。

```typescript
// ❌ 悪い例: 認可チェックなし
items: publicProcedure
  .input(z.object({ groupId: z.string().optional() }))
  .query(async ({ input }) => {
    return handler.execute(input)  // 誰でもgroupIdを指定できる
  }),

// ✅ 良い例: 認可チェックあり
items: protectedProcedure
  .input(z.object({ groupId: z.string().optional() }))
  .query(async ({ input, ctx }) => {
    // groupIdが指定された場合、ユーザーがメンバーか確認
    if (input.groupId) {
      const isMember = await checkGroupMembership(ctx.userId, input.groupId)
      if (!isMember) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }
    }
    return handler.execute({ ...input, userId: ctx.userId })
  }),
```

### 9.2 IDOR（Insecure Direct Object Reference）対策

IDのみでリソースにアクセスする場合、必ず所有権またはグループメンバーシップを確認する。

```typescript
// ❌ 悪い例: IDのみでアクセス
async delete(id: string): Promise<void> {
  await db.delete(items).where(eq(items.id, id))
}

// ✅ 良い例: 所有権を確認
async delete(id: string, userId: string): Promise<void> {
  const item = await this.findById(id)
  if (!item) throw new Error('Not found')

  // グループに属する場合はメンバーシップを確認
  if (item.groupId) {
    const isMember = await checkGroupMembership(userId, item.groupId)
    if (!isMember) throw new Error('Forbidden')
  }

  await db.delete(items).where(eq(items.id, id))
}
```

### 9.3 同期操作のセキュリティ

同期操作でも操作対象の権限を確認する。クライアントからのデータは信頼しない。

```typescript
async processOperation(op: SyncOperation, userId: string) {
  // 1. 操作対象のエンティティを取得
  const entity = await getEntity(op.entity, op.entityId)

  // 2. 権限を確認
  if (entity?.groupId) {
    const isMember = await checkGroupMembership(userId, entity.groupId)
    if (!isMember) {
      throw new Error('Forbidden: not a member of this group')
    }
  }

  // 3. 操作を実行
  await executeOperation(op)
}
```

### 9.4 招待リンクのセキュリティ

| 要件 | 実装 |
|------|------|
| トークンのエントロピー | 256ビット以上（`crypto.randomUUID()` または `crypto.randomBytes(32)`） |
| 有効期限 | 7日間 |
| 使用回数 | 1回のみ（使用後は `usedAt` を記録） |
| レート制限 | 同一グループへの招待リンク生成を制限（例: 10件/時間） |
| 取り消し機能 | オーナーが招待リンクを無効化可能 |

### 9.5 入力検証

```typescript
// 検索クエリの検証
export const searchQuerySchema = z.object({
  searchText: z.string()
    .max(100)  // 長さ制限
    .transform(s => s.replace(/[%_]/g, ''))  // LIKE特殊文字をエスケープ
    .optional(),
})
```

### 9.6 チェックリスト

実装時に以下を確認:

- [ ] すべてのprotectedProcedureでctx.userIdを使用している
- [ ] グループスコープのデータアクセスでメンバーシップを確認している
- [ ] IDによるアクセスで所有権を確認している
- [ ] 同期操作で権限を検証している
- [ ] 招待トークンは暗号論的に安全なランダム値を使用している
- [ ] ユーザー入力は適切にバリデーションしている
- [ ] エラーメッセージに機密情報を含めていない
- [ ] 本番環境のログに機密情報を出力していない

---

## 10. 関連ドキュメント

- [PRD.md](./PRD.md) - 製品要件定義
- [ADR-001: API技術選定](./adr/001-api-technology.md)
- [ADR-002: 境界づけられたコンテキスト](./adr/002-bounded-contexts.md)
- [ADR-003: CQRS実装方針](./adr/003-cqrs-implementation.md)
- [ADR-004: オフライン同期戦略](./adr/004-offline-sync-strategy.md)

---

## 変更履歴

| 日付 | バージョン | 変更内容 |
|------|-----------|---------|
| 2025-01-28 | 1.0 | 初版作成 |
| 2025-01-28 | 1.1 | ORM を Prisma から Drizzle に変更 |
| 2025-01-28 | 1.2 | セキュリティガイドラインを追加 |
