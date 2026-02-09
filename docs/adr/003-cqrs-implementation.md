# ADR-003: CQRS実装方針

## ステータス

**承認済み**

## コンテキスト

買い物メモアプリのデータアクセスパターンを決定する必要がある。

### 要件
- 書き込み時のビジネスルール検証
- 読み取り時のパフォーマンス
- コードの保守性
- 複雑性の管理

### 現状
- Dexie（IndexedDB）で直接CRUD操作
- ビジネスルールはUI層とDB層に散在

## 検討した選択肢

### 1. Active Record パターン

```typescript
class Item {
  id: string
  name: string

  async save() {
    await db.insert(items).values(this).onConflictDoUpdate({
      target: items.id,
      set: this,
    })
  }

  static async find(id: string) {
    return db.select().from(items).where(eq(items.id, id))
  }
}
```

**メリット**:
- シンプル
- 学習コスト低い

**デメリット**:
- エンティティとDBが密結合
- 読み書きの最適化が難しい
- テストしにくい

### 2. Repository パターン（読み書き統一）

```typescript
interface ItemRepository {
  findById(id: string): Promise<Item | null>
  findAll(filter: ItemFilter): Promise<Item[]>
  save(item: Item): Promise<void>
  delete(id: string): Promise<void>
}
```

**メリット**:
- DBから独立
- テストしやすい

**デメリット**:
- 読み取り専用クエリでもドメインモデルを経由
- 複雑な集計クエリが書きにくい

### 3. CQRS（Command Query Responsibility Segregation）

```typescript
// Command: ドメインモデルを経由
class CreateItemHandler {
  async execute(command: CreateItemCommand) {
    const item = Item.create(command)
    await this.repository.save(item)
  }
}

// Query: 直接DBから取得
class GetItemsHandler {
  async execute(query: GetItemsQuery) {
    return db.select().from(items).where(...)
  }
}
```

**メリット**:
- 読み書きを独立して最適化
- ドメインロジックが明確
- 読み取りは軽量

**デメリット**:
- コード量が増える
- 設計の学習コスト

## 決定

**軽量CQRSを採用する**

- **Command（書き込み）**: ドメインエンティティ → リポジトリ → DB
- **Query（読み取り）**: DB → DTO（ドメインモデルを経由しない）
- **Event Sourcing**: 採用しない

## 理由

### 1. 読み書きの特性が異なる

| 操作 | 特性 |
|------|------|
| 書き込み | バリデーション、ビジネスルール、整合性が重要 |
| 読み取り | パフォーマンス、柔軟なフィルタ、ページネーションが重要 |

### 2. 買い物メモアプリの操作パターン

| 操作 | 頻度 | 複雑性 |
|------|------|--------|
| アイテム一覧取得 | 高 | 低（フィルタのみ） |
| アイテム作成 | 中 | 中（バリデーション必要） |
| リスト作成 | 低 | 高（複数エンティティ） |
| 買い物完了 | 低 | 高（状態遷移 + 履歴作成） |

→ 読み取りはシンプルに、書き込みは堅牢にしたい

### 3. Event Sourcingを採用しない理由

| 観点 | 判断 |
|------|------|
| 監査ログ | PurchaseHistoryで十分 |
| リプレイ | 必要ない |
| 複雑性 | 個人開発には過剰 |
| 同期操作ログ | SyncOperationテーブルで代替 |

## 実装パターン

### Command（書き込み）

```typescript
// 1. コマンド定義
// src/modules/catalog/application/commands/CreateItem.ts

import { z } from 'zod'
import { createItemSchema } from '@/shared/schemas/item'

export type CreateItemCommand = z.infer<typeof createItemSchema> & {
  userId: string
}

export class CreateItemHandler {
  constructor(
    private readonly itemRepository: ItemRepository,
    private readonly tagRepository: TagRepository,
  ) {}

  async execute(command: CreateItemCommand): Promise<Item> {
    // 1. バリデーション（Zodで実行済み）

    // 2. ビジネスルールのチェック
    if (command.tagIds.length > 0) {
      const tags = await this.tagRepository.findByIds(command.tagIds)
      if (tags.length !== command.tagIds.length) {
        throw new Error('Invalid tag IDs')
      }
    }

    // 3. ドメインエンティティを生成
    const item = Item.create({
      name: command.name,
      quantity: command.quantity,
      memo: command.memo,
      tagIds: command.tagIds,
      groupId: command.groupId,
    })

    // 4. 永続化
    await this.itemRepository.save(item)

    return item
  }
}
```

```typescript
// 2. ドメインエンティティ
// src/modules/catalog/domain/entities/Item.ts

import { Quantity } from '../value-objects/Quantity'

export class Item {
  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly quantity: Quantity,
    public readonly memo: string | undefined,
    public readonly tagIds: string[],
    public readonly groupId: string | undefined,
    public readonly purchasedAt: Date | undefined,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    name: string
    quantity: number
    memo?: string
    tagIds: string[]
    groupId?: string
  }): Item {
    // インバリアントのチェック
    if (props.name.length < 1 || props.name.length > 100) {
      throw new Error('Item name must be between 1 and 100 characters')
    }

    const now = new Date()
    return new Item(
      generateId(),
      props.name,
      Quantity.create(props.quantity),
      props.memo,
      props.tagIds,
      props.groupId,
      undefined,
      now,
      now,
    )
  }

  updateName(name: string): Item {
    if (name.length < 1 || name.length > 100) {
      throw new Error('Item name must be between 1 and 100 characters')
    }
    return new Item(
      this.id,
      name,
      this.quantity,
      this.memo,
      this.tagIds,
      this.groupId,
      this.purchasedAt,
      this.createdAt,
      new Date(),
    )
  }

  markAsPurchased(): Item {
    if (this.purchasedAt) {
      throw new Error('Item is already purchased')
    }
    return new Item(
      this.id,
      this.name,
      this.quantity,
      this.memo,
      this.tagIds,
      this.groupId,
      new Date(),
      this.createdAt,
      new Date(),
    )
  }
}
```

```typescript
// 3. 値オブジェクト
// src/modules/catalog/domain/value-objects/Quantity.ts

export class Quantity {
  private constructor(public readonly value: number) {}

  static create(value: number): Quantity {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error('Quantity must be a positive integer')
    }
    return new Quantity(value)
  }

  add(amount: number): Quantity {
    return Quantity.create(this.value + amount)
  }
}
```

### Query（読み取り）

```typescript
// src/modules/catalog/application/queries/GetItems.ts
import { eq, and, isNull, ilike, inArray, desc } from 'drizzle-orm'
import { db } from '@/infrastructure/db/drizzle/client'
import { items, itemTags, tags, listItems, shoppingLists } from '@/infrastructure/db/drizzle/schema'

export interface GetItemsQuery {
  groupId?: string
  tagIds?: string[]
  searchText?: string
  includeCheckedInLists?: boolean
}

export interface ItemDTO {
  id: string
  name: string
  quantity: number
  memo?: string
  tagIds: string[]
  groupId?: string
  purchasedAt?: Date
  createdAt: Date
  // 追加情報
  tags: { id: string; name: string }[]
  inListIds: string[]  // どのリストに含まれているか
}

export class GetItemsHandler {
  constructor(private readonly db: typeof db) {}

  async execute(query: GetItemsQuery): Promise<ItemDTO[]> {
    // 条件を構築
    const conditions = [isNull(items.purchasedAt)]

    if (query.groupId) {
      conditions.push(eq(items.groupId, query.groupId))
    }
    if (query.searchText) {
      conditions.push(ilike(items.name, `%${query.searchText}%`))
    }

    // Drizzleで直接クエリ（ドメインモデルを経由しない）
    const itemResults = await this.db
      .select({
        id: items.id,
        name: items.name,
        quantity: items.quantity,
        memo: items.memo,
        groupId: items.groupId,
        purchasedAt: items.purchasedAt,
        createdAt: items.createdAt,
      })
      .from(items)
      .where(and(...conditions))
      .orderBy(desc(items.createdAt))

    if (itemResults.length === 0) {
      return []
    }

    const itemIds = itemResults.map(i => i.id)

    // タグ情報を取得
    const tagResults = await this.db
      .select({
        itemId: itemTags.itemId,
        tagId: tags.id,
        tagName: tags.name,
      })
      .from(itemTags)
      .innerJoin(tags, eq(itemTags.tagId, tags.id))
      .where(inArray(itemTags.itemId, itemIds))

    // リストに含まれているかを取得
    const listItemResults = await this.db
      .select({
        name: listItems.name,
        listId: listItems.listId,
      })
      .from(listItems)
      .innerJoin(shoppingLists, eq(listItems.listId, shoppingLists.id))
      .where(and(
        inArray(listItems.name, itemResults.map(i => i.name)),
        eq(shoppingLists.status, 'in_progress')
      ))

    // マップを構築
    const tagMap = new Map<string, { id: string; name: string }[]>()
    for (const t of tagResults) {
      const existing = tagMap.get(t.itemId) || []
      existing.push({ id: t.tagId, name: t.tagName })
      tagMap.set(t.itemId, existing)
    }

    const listMap = new Map<string, string[]>()
    for (const li of listItemResults) {
      const ids = listMap.get(li.name) || []
      ids.push(li.listId)
      listMap.set(li.name, ids)
    }

    // DTOに変換
    return itemResults.map(item => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      memo: item.memo ?? undefined,
      tagIds: (tagMap.get(item.id) || []).map(t => t.id),
      groupId: item.groupId ?? undefined,
      purchasedAt: item.purchasedAt ?? undefined,
      createdAt: item.createdAt,
      tags: tagMap.get(item.id) || [],
      inListIds: listMap.get(item.name) || [],
    }))
  }
}
```

### tRPCでの統合

```typescript
// src/infrastructure/trpc/routers/catalog.ts

import { z } from 'zod'
import { router, publicProcedure, protectedProcedure } from '../server'
import { createItemSchema, updateItemSchema } from '@/shared/schemas/item'
import { CreateItemHandler } from '@/modules/catalog/application/commands/CreateItem'
import { GetItemsHandler } from '@/modules/catalog/application/queries/GetItems'
import { DrizzleItemRepository } from '@/modules/catalog/infrastructure/repositories/ItemRepository'
import { DrizzleTagRepository } from '@/modules/catalog/infrastructure/repositories/TagRepository'
import { db } from '@/infrastructure/db/drizzle/client'

export const catalogRouter = router({
  // Query: 直接Handler呼び出し
  items: publicProcedure
    .input(z.object({
      groupId: z.string().optional(),
      tagIds: z.array(z.string()).optional(),
      searchText: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const handler = new GetItemsHandler(db)
      return handler.execute(input)
    }),

  // Command: ドメインモデルを経由
  createItem: protectedProcedure
    .input(createItemSchema)
    .mutation(async ({ input, ctx }) => {
      const handler = new CreateItemHandler(
        new DrizzleItemRepository(db),
        new DrizzleTagRepository(db),
      )
      return handler.execute({ ...input, userId: ctx.userId })
    }),

  updateItem: protectedProcedure
    .input(updateItemSchema)
    .mutation(async ({ input, ctx }) => {
      const handler = new UpdateItemHandler(
        new DrizzleItemRepository(db),
      )
      return handler.execute({ ...input, userId: ctx.userId })
    }),
})
```

## 複雑なコマンドの例

```typescript
// src/modules/shopping/application/commands/FinishShopping.ts

export interface FinishShoppingCommand {
  listId: string
  location?: string
  userId: string
}

export class FinishShoppingHandler {
  constructor(
    private readonly listRepository: ShoppingListRepository,
    private readonly historyRepository: PurchaseHistoryRepository,
    private readonly itemRepository: ItemRepository,
  ) {}

  async execute(command: FinishShoppingCommand): Promise<PurchaseHistory> {
    // 1. リストを取得
    const list = await this.listRepository.findById(command.listId)
    if (!list) {
      throw new Error('List not found')
    }
    if (list.status === 'completed') {
      throw new Error('List is already completed')
    }

    // 2. リストを完了
    const completedList = list.complete()

    // 3. チェック済みアイテムを履歴に記録
    const checkedItems = list.items.filter(i => i.checked)
    const history = PurchaseHistory.create({
      listId: list.id,
      location: command.location,
      itemIds: checkedItems.map(i => i.id),
      groupId: list.groupId,
    })

    // 4. チェック済みアイテムのpurchasedAtを更新
    const itemIds = checkedItems.map(i => i.id)
    await this.itemRepository.markAsPurchased(itemIds)

    // 5. トランザクションで保存
    await this.listRepository.save(completedList)
    await this.historyRepository.save(history)

    return history
  }
}
```

## 影響

### ポジティブ
- 読み取りは軽量で高速
- 書き込みはビジネスルールが明確
- テストが書きやすい（Command/Queryを分離してテスト可能）

### ネガティブ
- ファイル数が増える
- Command/Query間でデータの不整合が起きる可能性（ただし即時反映なので問題なし）

### 対策
- 小さなアプリなのでHandler数は限定的
- 不整合はトランザクションで防ぐ

## 参考資料

- [Martin Fowler - CQRS](https://martinfowler.com/bliki/CQRS.html)
- [Greg Young - CQRS Documents](https://cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf)
