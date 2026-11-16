---
name: postgres-patterns
description: PostgreSQLのベストプラクティス。クエリ最適化、スキーマ設計、インデックス、RLS（Row Level Security）のパターン集。
tools: ["Read", "Bash", "Grep"]
---

# PostgreSQLパターン

PostgreSQL + Drizzle ORM でのデータベース設計・最適化パターン集。スキーマは `src/infrastructure/db/drizzle/schema.ts`。

## 適用タイミング

- SQLクエリ作成時
- スキーマ設計時
- パフォーマンス問題のトラブルシュート
- Row Level Security (RLS) 実装時
- コネクションプーリング設定時

## データ型の推奨

| 用途 | 推奨型（Drizzle） | 理由 |
|------|--------|------|
| ID | `text("id").primaryKey()`（アプリで UUID を生成） | ローカル（Dexie）で作った ID をそのまま同期できる |
| 文字列 | `text()` | 可変長、制限不要 |
| 日時 | `timestamp()`（タイムゾーンが必要なら `{ withTimezone: true }`） | `defaultNow()` で作成日時 |
| 金額 | `numeric({ precision: 10, scale: 2 })` | 精度保証 |
| フラグ | `boolean().notNull().default(false)` | 明示的 |
| JSON | `jsonb()` | 検索・インデックス可能 |
| 配列 | `text().array()` | スナップショット用途（例: `listItems.tagIds`） |

## インデックス設計

### インデックスタイプの選択

| クエリパターン | インデックス | 例 |
|---------------|-------------|-----|
| 等価検索 (=) | B-tree (デフォルト) | `index("items_user_idx").on(t.userId)` |
| 範囲検索 (<, >, BETWEEN) | B-tree | `index("items_purchased_idx").on(t.purchasedAt)` |
| JSON / 配列検索 | GIN | `index("x_idx").using("gin", t.metadata)`（汎用例。このプロジェクトに jsonb 列はない） |
| 全文検索 | GIN | Full-text search |
| 時系列データ | BRIN | 大量の時系列 |

### Drizzle でのインデックス定義

```typescript
// 例（架空のテーブル。実際のスキーマは src/infrastructure/db/drizzle/schema.ts）
export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // 単一インデックス
    index("notes_list_idx").on(table.listId),
    index("notes_user_idx").on(table.userId),

    // 複合インデックス（順序が重要！）
    index("notes_list_created_idx").on(table.listId, table.createdAt.desc()),

    // ユニーク制約
    uniqueIndex("notes_list_title_idx").on(table.listId, table.title),
  ]
)
```

変更後は `npm run db:generate` でマイグレーション SQL を生成し、内容を確認してから `npm run db:migrate` で適用する。

### 複合インデックスの順序

```
カーディナリティ: 高 → 低 の順に配置

✅ 良い例: [userId, status, createdAt]
   - userId: 高カーディナリティ（多くの異なる値）
   - status: 低カーディナリティ（数種類）
   - createdAt: ソート用

❌ 悪い例: [status, userId, createdAt]
   - statusが先だと効率が悪い
```

## クエリ最適化

`schema.ts` には `relations()` を定義していないため、関連データは JOIN か `inArray` で取得する。

### N+1問題の回避

```typescript
// ❌ N+1問題
const lists = await db.select().from(shoppingLists).where(eq(shoppingLists.userId, userId))
for (const list of lists) {
  const rows = await db.select().from(listItems).where(eq(listItems.listId, list.id))
}

// ✅ inArray で一括取得
const rows = await db
  .select()
  .from(listItems)
  .where(inArray(listItems.listId, lists.map((l) => l.id)))
```

### 必要なカラムのみ取得

```typescript
// ❌ 全カラム取得
const rows = await db.select().from(users)

// ✅ 必要なカラムのみ
const rows = await db.select({ id: users.id, name: users.name }).from(users)
```

### カーソルベースのページネーション

```typescript
// ✅ 推奨: カーソル（直前ページ最後の createdAt）より古いものを取得
const rows = await db
  .select()
  .from(items)
  .where(lt(items.createdAt, cursor))
  .orderBy(desc(items.createdAt))
  .limit(20)

// ⚠️ オフセット（大量データで遅い）
const rows = await db.select().from(items).orderBy(desc(items.createdAt)).limit(20).offset(page * 20)
```

### UPSERT（挿入または更新）

```typescript
const [item] = await db
  .insert(items)
  .values({ id, name, quantity, userId })
  .onConflictDoUpdate({
    target: items.id,
    set: { name, quantity, updatedAt: new Date() },
  })
  .returning()
```

## トランザクション

```typescript
const result = await db.transaction(async (tx) => {
  const [list] = await tx.select().from(shoppingLists).where(eq(shoppingLists.id, listId))
  if (!list) throw new Error("リストが見つかりません")

  await tx
    .update(shoppingLists)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(shoppingLists.id, listId))

  return tx.select().from(listItems).where(eq(listItems.listId, listId))
})
```

> 本番の Neon pooler（PgBouncer）はプリペアドステートメント非対応のため、`client.ts` で `prepare: false` を指定している。

## パフォーマンス診断

### スロークエリの検出

```sql
-- pg_stat_statements を使用（要拡張機能）
SELECT
  query,
  calls,
  mean_exec_time,
  total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### インデックス未使用の外部キー検出

```sql
SELECT
  c.conrelid::regclass AS table_name,
  a.attname AS column_name
FROM pg_constraint c
JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
WHERE c.contype = 'f'
AND NOT EXISTS (
  SELECT 1 FROM pg_index i
  WHERE i.indrelid = c.conrelid
  AND a.attnum = ANY(i.indkey)
);
```

### テーブル肥大化の確認

```sql
SELECT
  schemaname,
  relname,
  n_dead_tup,
  n_live_tup,
  round(n_dead_tup::numeric / nullif(n_live_tup, 0) * 100, 2) as dead_ratio
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

## Row Level Security (RLS)

### PostgreSQL直接使用時（参考）

```sql
-- ユーザーは所属グループのデータのみアクセス可能
CREATE POLICY "Users can view own group lists"
ON shopping_lists
FOR SELECT
USING (
  group_id IN (
    SELECT group_id FROM group_members
    WHERE user_id = current_setting('app.user_id')
  )
);
```

### このプロジェクトでの実装（アプリケーションレベル）

RLS は使わず、tRPC のプロシージャで認可する。グループのデータは
`src/infrastructure/trpc/middleware/groupAuth.ts` の `verifyGroupMembership` / `verifyGroupOwnership` で検証する。

```typescript
// 所属グループのリストのみ取得
const memberships = await db
  .select({ groupId: groupMembers.groupId })
  .from(groupMembers)
  .where(eq(groupMembers.userId, userId))

const groupIds = memberships.map((m) => m.groupId)

const lists = await db
  .select()
  .from(shoppingLists)
  .where(inArray(shoppingLists.groupId, groupIds))
```

## アンチパターン

### ❌ 避けるべき

```typescript
// 無制限クエリ
await db.select().from(items) // LIMIT なし

// ループ内クエリ（N+1）
for (const list of lists) {
  await db.select().from(listItems).where(eq(listItems.listId, list.id))
}

// 文字列連結で SQL を組み立てる（SQLインジェクション）
await db.execute(sql.raw(`SELECT * FROM items WHERE name = '${name}'`))

// インデックスなしの外部キー
listId: text("list_id").references(() => shoppingLists.id) // index() なし
```

### ✅ 推奨

```typescript
// 制限付きクエリ
await db.select().from(items).limit(100)

// inArray / JOIN で一括取得
await db.select().from(listItems).where(inArray(listItems.listId, listIds))

// 必要なカラムのみ
await db.select({ id: users.id, name: users.name }).from(users)

// sql テンプレートは値をパラメータとして埋め込む
await db.execute(sql`SELECT * FROM items WHERE name = ${name}`)

// インデックス付き
(table) => [index("list_items_list_idx").on(table.listId)]
```

## 関連エージェント

- `database-reviewer`: データベース設計の詳細レビュー
- `architect`: スキーマ設計の相談
