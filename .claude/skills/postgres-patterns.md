---
name: postgres-patterns
description: PostgreSQLのベストプラクティス。クエリ最適化、スキーマ設計、インデックス、RLS（Row Level Security）のパターン集。
tools: ["Read", "Bash", "Grep"]
---

# PostgreSQLパターン

PostgreSQL + Prisma でのデータベース設計・最適化パターン集。

## 適用タイミング

- SQLクエリ作成時
- スキーマ設計時
- パフォーマンス問題のトラブルシュート
- Row Level Security (RLS) 実装時
- コネクションプーリング設定時

## データ型の推奨

| 用途 | 推奨型 | 理由 |
|------|--------|------|
| ID | `String @id @default(cuid())` | 分散ID、URLセーフ |
| 文字列 | `String` (text) | 可変長、制限不要 |
| 日時 | `DateTime` (timestamptz) | タイムゾーン対応 |
| 金額 | `Decimal @db.Decimal(10,2)` | 精度保証 |
| フラグ | `Boolean @default(false)` | 明示的 |
| JSON | `Json` (jsonb) | 検索・インデックス可能 |

## インデックス設計

### インデックスタイプの選択

| クエリパターン | インデックス | 例 |
|---------------|-------------|-----|
| 等価検索 (=) | B-tree (デフォルト) | `@@index([userId])` |
| 範囲検索 (<, >, BETWEEN) | B-tree | `@@index([createdAt])` |
| JSON検索 | GIN | `@@index([metadata], type: Gin)` |
| 全文検索 | GIN | Full-text search |
| 時系列データ | BRIN | 大量の時系列 |

### Prismaでのインデックス定義

```prisma
model ShoppingItem {
  id        String   @id @default(cuid())
  name      String
  listId    String
  createdBy String
  createdAt DateTime @default(now())

  // 単一インデックス
  @@index([listId])
  @@index([createdBy])

  // 複合インデックス（順序が重要！）
  @@index([listId, createdAt(sort: Desc)])

  // ユニーク制約
  @@unique([listId, name])
}
```

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

### N+1問題の回避

```typescript
// ❌ N+1問題
const lists = await prisma.shoppingList.findMany()
for (const list of lists) {
  const items = await prisma.shoppingItem.findMany({
    where: { listId: list.id }
  })
}

// ✅ includeで解決
const lists = await prisma.shoppingList.findMany({
  include: {
    items: true,
    family: {
      select: { name: true }
    }
  }
})
```

### 必要なカラムのみ取得

```typescript
// ❌ 全カラム取得
const users = await prisma.user.findMany()

// ✅ 必要なカラムのみ
const users = await prisma.user.findMany({
  select: {
    id: true,
    name: true,
    email: true,
  }
})
```

### カーソルベースのページネーション

```typescript
// ✅ 推奨: カーソルベース（大量データでも高速）
const items = await prisma.shoppingItem.findMany({
  take: 20,
  skip: 1, // カーソルの次から
  cursor: { id: lastItemId },
  orderBy: { createdAt: 'desc' },
})

// ⚠️ 非推奨: オフセットベース（大量データで遅い）
const items = await prisma.shoppingItem.findMany({
  take: 20,
  skip: page * 20, // 大きいページで遅くなる
})
```

### UPSERT（挿入または更新）

```typescript
const item = await prisma.shoppingItem.upsert({
  where: {
    listId_name: { listId, name: itemName }
  },
  update: {
    quantity: { increment: 1 }
  },
  create: {
    listId,
    name: itemName,
    quantity: 1,
    createdBy: userId,
  }
})
```

## トランザクション

```typescript
// 複数の操作を原子的に実行
const [list, membership] = await prisma.$transaction([
  prisma.shoppingList.create({
    data: { name: '新しいリスト', familyId }
  }),
  prisma.familyMember.update({
    where: { userId_familyId: { userId, familyId } },
    data: { lastActiveAt: new Date() }
  })
])

// インタラクティブトランザクション
const result = await prisma.$transaction(async (tx) => {
  const item = await tx.shoppingItem.findUnique({
    where: { id: itemId }
  })

  if (!item) throw new Error('Item not found')

  return tx.shoppingItem.update({
    where: { id: itemId },
    data: { quantity: item.quantity + 1 }
  })
})
```

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

### Supabase/PostgreSQL直接使用時

```sql
-- ユーザーは自分の家族のデータのみアクセス可能
CREATE POLICY "Users can view own family lists"
ON shopping_lists
FOR SELECT
USING (
  family_id IN (
    SELECT family_id FROM family_members
    WHERE user_id = auth.uid()
  )
);
```

### Prisma経由での実装

Prismaはアプリケーションレベルで認可を実装:

```typescript
// middleware または wrapper で実装
async function getListsForUser(userId: string) {
  // ユーザーの家族IDを取得
  const memberships = await prisma.familyMember.findMany({
    where: { userId },
    select: { familyId: true }
  })

  const familyIds = memberships.map(m => m.familyId)

  // 家族に紐づくリストのみ取得
  return prisma.shoppingList.findMany({
    where: {
      familyId: { in: familyIds }
    }
  })
}
```

## アンチパターン

### ❌ 避けるべき

```typescript
// 無制限クエリ
await prisma.item.findMany() // LIMIT なし

// ループ内クエリ（N+1）
for (const list of lists) {
  await prisma.item.findMany({ where: { listId: list.id } })
}

// SELECT *
await prisma.user.findMany() // 全カラム

// インデックスなしの外部キー
model Item {
  listId String // @@index([listId]) なし
}
```

### ✅ 推奨

```typescript
// 制限付きクエリ
await prisma.item.findMany({ take: 100 })

// include/select で一括取得
await prisma.list.findMany({ include: { items: true } })

// 必要なカラムのみ
await prisma.user.findMany({ select: { id: true, name: true } })

// インデックス付き
model Item {
  listId String
  @@index([listId])
}
```

## 関連エージェント

- `database-reviewer`: データベース設計の詳細レビュー
- `architect`: スキーマ設計の相談
