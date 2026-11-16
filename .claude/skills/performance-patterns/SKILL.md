---
name: performance-patterns
description: React 再レンダリング防止、コード分割、Drizzle のクエリ・インデックス、Next.js キャッシュ、ビルドエラー解決、Web Vitals 計測の例。パフォーマンス改善や遅さの調査時に使う。
---

# パフォーマンス最適化パターン

DB のより詳しいパターンは `postgres-patterns` スキルを参照。

## フロントエンド最適化

### React再レンダリング防止

```typescript
// ❌ 毎回再レンダリング
function List({ items }) {
  return items.map(item => <Item key={item.id} data={item} />)
}

// ✅ メモ化で防止
const Item = memo(function Item({ data }) {
  return <div>{data.name}</div>
})

// ✅ useMemo で計算結果をキャッシュ
const sortedItems = useMemo(
  () => items.sort((a, b) => a.name.localeCompare(b.name)),
  [items]
)

// ✅ useCallback でコールバックをメモ化
const handleClick = useCallback((id) => {
  setSelectedId(id)
}, [])
```

### コード分割

```typescript
// 重いコンポーネントを遅延読み込み
import dynamic from 'next/dynamic'

const HeavyChart = dynamic(() => import('@/components/HeavyChart'), {
  loading: () => <Skeleton />,
  ssr: false,
})
```

### 画像最適化

```typescript
// Next.js Image コンポーネントを使用
import Image from 'next/image'

<Image
  src="/photo.jpg"
  alt="説明"
  width={800}
  height={600}
  placeholder="blur"
  loading="lazy"
/>
```

## バックエンド最適化

### データベースクエリ

```typescript
// ❌ N+1問題
const lists = await db.select().from(shoppingLists)
for (const list of lists) {
  const rows = await db.select().from(listItems).where(eq(listItems.listId, list.id))
}

// ✅ inArray で一括取得
const rows = await db
  .select()
  .from(listItems)
  .where(inArray(listItems.listId, lists.map((l) => l.id)))

// ✅ 必要なカラムのみ取得
const rows = await db.select({ id: users.id, name: users.name }).from(users)
```

### インデックス

```typescript
// 例（架空のテーブル。実際のスキーマは src/infrastructure/db/drizzle/schema.ts）
export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    listId: text("list_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // クエリパターンに基づくインデックス
  (table) => [
    index("notes_list_idx").on(table.listId),
    index("notes_list_created_idx").on(table.listId, table.createdAt.desc()),
  ]
)
```

### キャッシュ戦略

```typescript
// Next.js の fetch キャッシュ
const data = await fetch('/api/items', {
  next: { revalidate: 60 } // 60秒キャッシュ
})

// unstable_cache (App Router)
import { unstable_cache } from 'next/cache'

const getCachedItems = unstable_cache(
  async (listId: string) => {
    return db.select().from(listItems).where(eq(listItems.listId, listId))
  },
  ['items'],
  { revalidate: 60 }
)
```

## ビルドエラー解決

### 推奨アプローチ

```
1. エラーを収集
   npm run build 2>&1 | head -50

2. 1つずつ修正
   - 最小限の変更
   - 毎回再ビルドで確認

3. 検証
   - 新しいエラーが発生していないこと
   - テストがパスすること
```

### build-error-resolver エージェントを使用

```
/build-fix
```

## 計測

### Web Vitals

```typescript
// src/app/layout.tsx
import { SpeedInsights } from '@vercel/speed-insights/next'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <SpeedInsights />
      </body>
    </html>
  )
}
```

### Lighthouse

```bash
# ローカルで計測
npx lighthouse http://localhost:3000 --view

# 特定カテゴリのみ
npx lighthouse http://localhost:3000 --only-categories=performance --view
```

### 目標スコア

| カテゴリ | 目標 |
|---------|------|
| Performance | 90+ |
| Accessibility | 100 |
| Best Practices | 100 |
| SEO | 100 |
| PWA | 90+ |

## アンチパターン

### ❌ 避けるべき

```typescript
// コンポーネント内でオブジェクト生成
<Button style={{ color: 'red' }} />  // 毎回新しいオブジェクト

// 無駄な状態更新
setItems([...items])  // 同じ内容なのに再レンダリング

// 巨大なバンドル
import _ from 'lodash'  // 全部インポート

// 無制限クエリ
db.select().from(items)  // LIMIT なし
```

### ✅ 推奨

```typescript
// スタイルを外に定義
const buttonStyle = { color: 'red' }
<Button style={buttonStyle} />

// 必要な時だけ更新
if (hasChanges) setItems(newItems)

// 必要な関数のみ
import debounce from 'lodash/debounce'

// 制限付きクエリ
db.select().from(items).limit(100)
```
