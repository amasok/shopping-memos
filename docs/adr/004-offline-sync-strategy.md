# ADR-004: オフライン同期戦略

## ステータス

**承認済み**

## コンテキスト

買い物メモアプリはオフラインファーストPWAとして設計されている。ローカルDB（Dexie/IndexedDB）とサーバーDB（PostgreSQL）間の同期戦略を決定する必要がある。

### 現状
- ローカルDB: Dexie（IndexedDB）で全機能が動作
- サーバーDB: Drizzle ORM + PostgreSQL（未接続）
- 認証: NextAuth（設定済み、未使用）

### 要件
1. ゲストモード（未ログイン）でも全機能が使える
2. ログイン後はデバイス間で同期
3. オフライン時もアプリが使える
4. 競合を最小限に抑える

### 制約
- リアルタイム同期は不要（ユーザー決定）
- 個人開発のため複雑な同期は避けたい

## 検討した選択肢

### 1. リアルタイム同期（WebSocket/SSE）

```
Client A ←───WebSocket───→ Server ←───WebSocket───→ Client B
```

**メリット**:
- 即座に反映
- 複数デバイスで同時編集可能

**デメリット**:
- 実装が複雑
- サーバーリソースが必要
- オフライン時の処理が複雑

### 2. ポーリング同期

```
Client → GET /sync/changes?since=timestamp → Server
```

**メリット**:
- シンプル
- サーバーがステートレス

**デメリット**:
- リアルタイム性がない
- 無駄なリクエストが発生

### 3. 手動更新 + バックグラウンド同期

```
[ローカル操作] → [即時反映] → [バックグラウンド同期] → [サーバー]
```

**メリット**:
- UXが良い（即時反映）
- 実装がシンプル
- オフライン対応が容易

**デメリット**:
- 同時編集時に競合の可能性

## 決定

**手動更新 + バックグラウンド同期を採用する**

- ローカル操作は即時反映
- オンライン時にバックグラウンドで同期
- 競合はLast Write Winsで解決
- 手動更新ボタン（Pull to Refresh）を提供

## 理由

### 1. ユースケースとの適合

| ユースケース | 同期要件 |
|-------------|---------|
| 買いたいものを追加 | 即時反映、同期は後で |
| 買い物中にチェック | 即時反映が最重要 |
| 家族の追加を確認 | 手動更新で十分 |

→ リアルタイム同期は過剰

### 2. 競合の発生頻度

| シナリオ | 頻度 | 対応 |
|---------|------|------|
| 同じアイテムを同時編集 | 稀 | Last Write Wins |
| 同時に削除と編集 | 稀 | 削除優先 |
| 同じリストで同時買い物 | ほぼない | 想定外（警告） |

→ 複雑な競合解決は不要

### 3. リアルタイム同期不要の決定

ユーザーとの協議により決定:
- 夫婦2人での利用が主
- 同時に買い物することはほぼない
- 即時性より確実性を重視

## 同期アーキテクチャ

### 概要

```
┌─────────────────────────────────────────────────────────────────┐
│                          Client                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐ │
│  │   React     │───→│   Dexie     │───→│    Sync Queue       │ │
│  │ Components  │    │ (IndexedDB) │    │ (pending operations)│ │
│  └─────────────┘    └─────────────┘    └──────────┬──────────┘ │
│         ↑                                         │             │
│         │ UI Update                               │ Background  │
│         │ (Optimistic)                            │ Sync        │
│         │                                         ↓             │
│  ┌──────┴──────────────────────────────────────────────────┐   │
│  │                     Sync Engine                          │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────────────────┐│   │
│  │  │  Push     │  │   Pull    │  │  Conflict Resolver    ││   │
│  │  │  Handler  │  │   Handler │  │  (Last Write Wins)    ││   │
│  │  └─────┬─────┘  └─────┬─────┘  └───────────────────────┘│   │
│  └────────┼──────────────┼──────────────────────────────────┘   │
└───────────┼──────────────┼──────────────────────────────────────┘
            │              │
            ↓              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         Server                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   tRPC Endpoints                         │   │
│  │   /sync/push    /sync/pull    /sync/merge               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↓                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                PostgreSQL + Drizzle                      │   │
│  │   items, tags, lists, listItems, history, syncOperations │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### データフロー

#### 1. ローカル操作

```typescript
// src/lib/db/items.ts（既存コードを拡張）
export async function createItem(item: Omit<ShoppingItem, 'id' | 'createdAt' | 'updatedAt'>) {
  const now = new Date()
  const newItem: ShoppingItem = {
    id: generateId(),
    ...item,
    createdAt: now,
    updatedAt: now,
  }

  // 1. Dexieに保存（即時）
  await db.items.add(newItem)

  // 2. 同期キューに追加（バックグラウンド）
  await addToSyncQueue({
    entity: 'item',
    operation: 'create',
    entityId: newItem.id,
    payload: newItem,
  })

  return newItem
}
```

#### 2. バックグラウンド同期

```typescript
// src/infrastructure/sync/SyncEngine.ts
export class SyncEngine {
  private isOnline = navigator.onLine

  constructor() {
    window.addEventListener('online', () => this.handleOnline())
    window.addEventListener('offline', () => this.handleOffline())
  }

  private async handleOnline() {
    this.isOnline = true
    await this.syncPendingOperations()
  }

  private async handleOffline() {
    this.isOnline = false
  }

  async syncPendingOperations() {
    if (!this.isOnline) return

    const pendingOps = await getSyncQueue()
    if (pendingOps.length === 0) return

    try {
      // バッチで送信
      const result = await trpc.sync.push.mutate({
        operations: pendingOps,
      })

      // 成功した操作をキューから削除
      await clearSyncQueue(result.processedIds)

      // 競合があれば解決
      if (result.conflicts.length > 0) {
        await this.resolveConflicts(result.conflicts)
      }
    } catch (error) {
      // ネットワークエラーは無視（次回リトライ）
      console.error('Sync failed:', error)
    }
  }

  private async resolveConflicts(conflicts: Conflict[]) {
    for (const conflict of conflicts) {
      // Last Write Wins: サーバーの値を採用
      await this.applyServerValue(conflict)
    }
  }
}
```

#### 3. サーバー側処理

```typescript
// src/infrastructure/trpc/routers/sync.ts
export const syncRouter = router({
  push: protectedProcedure
    .input(z.object({
      operations: z.array(syncOperationSchema),
    }))
    .mutation(async ({ input, ctx }) => {
      const processedIds: string[] = []
      const conflicts: Conflict[] = []

      for (const op of input.operations) {
        try {
          const result = await processOperation(op, ctx.userId)
          if (result.conflict) {
            conflicts.push(result.conflict)
          } else {
            processedIds.push(op.id)
          }
        } catch (error) {
          // 操作ごとのエラーを記録
          console.error(`Operation failed: ${op.id}`, error)
        }
      }

      return { processedIds, conflicts }
    }),

  pull: protectedProcedure
    .input(z.object({
      since: z.date().optional(),
    }))
    .query(async ({ input, ctx }) => {
      // ユーザーがアクセスできるグループのデータを取得
      const groups = await getUserGroups(ctx.userId)
      const groupIds = groups.map(g => g.id)

      const changes = await getChangesSince(input.since, groupIds)
      return changes
    }),
})
```

### 初回ログイン時のマージ

```typescript
// src/infrastructure/sync/merge.ts
export async function mergeLocalDataOnLogin(userId: string) {
  // 1. ローカルデータを収集
  const localData = {
    items: await db.items.toArray(),
    tags: await db.tags.toArray(),
    lists: await db.lists.toArray(),
    listItems: await db.listItems.toArray(),
    history: await db.history.toArray(),
  }

  // 2. サーバーにマージリクエスト
  const result = await trpc.sync.merge.mutate({
    data: localData,
    userId,
  })

  // 3. IDマッピングを適用
  await applyIdMappings(result.idMappings)

  // 4. サーバーデータをローカルに反映
  await applyServerData(result.serverData)

  // 5. 同期完了フラグを設定
  localStorage.setItem('syncedAt', new Date().toISOString())
}
```

## 競合解決

### Last Write Wins

```typescript
// src/infrastructure/sync/ConflictResolver.ts
export function resolveConflict(
  local: SyncOperation,
  server: { updatedAt: Date; data: unknown }
): 'local' | 'server' {
  const localTime = new Date(local.createdAt).getTime()
  const serverTime = server.updatedAt.getTime()

  // 後の更新が勝つ
  return localTime > serverTime ? 'local' : 'server'
}
```

### 特殊ケース

| シナリオ | 解決方法 |
|---------|---------|
| 削除 vs 編集 | 削除を優先 |
| 同名アイテムの作成 | 両方残す（重複） |
| グループ削除 vs メンバー追加 | 削除を優先 |

```typescript
// 削除を常に優先する例
if (local.operation === 'delete' || server.operation === 'delete') {
  return 'delete'
}
```

## データモデル

### 同期キュー（ローカル）

```typescript
// Dexieに追加
interface SyncQueueItem {
  id: string
  entity: 'item' | 'tag' | 'list' | 'listItem' | 'history'
  entityId: string
  operation: 'create' | 'update' | 'delete'
  payload: unknown
  createdAt: Date
  retryCount: number
}

// version 7 として追加
this.version(7).stores({
  // ... 既存のstore
  syncQueue: 'id, entity, createdAt',
})
```

### 同期操作ログ（サーバー）

```typescript
// src/infrastructure/db/drizzle/schema.ts
export const syncOperations = pgTable('sync_operations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  entity: text('entity').notNull(),  // 'item' | 'tag' | 'list' | 'listItem' | 'history'
  entityId: text('entity_id').notNull(),
  operation: text('operation').notNull(),  // 'create' | 'update' | 'delete'
  payload: text('payload').notNull(),  // JSON文字列
  localId: text('local_id'),  // マージ時のローカルID
  syncedAt: timestamp('synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userSyncIdx: index('sync_user_idx').on(table.userId, table.syncedAt),
  entityIdx: index('sync_entity_idx').on(table.entity, table.entityId),
}))
```

## 手動更新

### Pull to Refresh

```typescript
// src/components/PullToRefresh.tsx
export function PullToRefresh({ onRefresh, children }) {
  const handleRefresh = async () => {
    const lastSync = localStorage.getItem('lastSyncAt')
    const changes = await trpc.sync.pull.query({
      since: lastSync ? new Date(lastSync) : undefined,
    })

    await applyChanges(changes)
    localStorage.setItem('lastSyncAt', new Date().toISOString())
  }

  return (
    <PullToRefreshWrapper onRefresh={handleRefresh}>
      {children}
    </PullToRefreshWrapper>
  )
}
```

### 更新ボタン

```typescript
// ヘッダーに更新ボタンを配置
<Button onClick={handleRefresh} disabled={isSyncing}>
  <RefreshIcon className={isSyncing ? 'animate-spin' : ''} />
</Button>
```

## 同期状態の表示

```typescript
// src/contexts/SyncContext.tsx
interface SyncState {
  isOnline: boolean
  isSyncing: boolean
  pendingCount: number
  lastSyncAt: Date | null
  error: Error | null
}

// UIでの表示
{!isOnline && <OfflineBanner />}
{pendingCount > 0 && <PendingSyncIndicator count={pendingCount} />}
{error && <SyncErrorToast error={error} />}
```

## 実装フェーズ

### Phase 2-1: 基盤

- [ ] SyncQueueをDexieに追加
- [ ] SyncEngineの基本実装
- [ ] オンライン/オフライン検出

### Phase 2-2: Push同期

- [ ] ローカル操作後のキュー追加
- [ ] バックグラウンドプッシュ
- [ ] リトライ機構

### Phase 2-3: Pull同期

- [ ] 手動更新ボタン
- [ ] Pull to Refresh
- [ ] 差分マージ

### Phase 2-4: マージ

- [ ] 初回ログイン時のマージ
- [ ] IDマッピング
- [ ] 競合解決

## 影響

### ポジティブ
- オフラインでも完全に動作
- 即時レスポンス（Optimistic UI）
- シンプルな実装

### ネガティブ
- リアルタイム反映がない
- 競合時にデータが失われる可能性（Last Write Wins）

### 対策
- 手動更新ボタンを目立たせる
- 重要な競合は通知する（Phase 3）
- 同期状態を常に表示

## 参考資料

- [Offline First Community](https://offlinefirst.org/)
- [CouchDB Replication Protocol](https://docs.couchdb.org/en/stable/replication/protocol.html)
- [Dexie.js Syncable](https://dexie.org/docs/Syncable/Dexie.Syncable.js)
