---
name: coding-standards
description: TypeScript/React/Next.jsのコーディング規約とベストプラクティス。命名規則、エラーハンドリング、型安全性、ファイル構成。
---

# コーディング規約

TypeScript/React/Next.js プロジェクトのコーディング規約とベストプラクティス。

## 基本原則

1. **可読性第一** - 明確な命名、自己文書化コード
2. **KISS** - シンプルな解決策を選ぶ
3. **DRY** - 重複を排除、再利用可能なロジックを抽出
4. **YAGNI** - 今必要なものだけを作る

## 命名規則

### 変数

```typescript
// ❌ 曖昧な名前
const q = 'search query'
const d = new Date()
const arr = []

// ✅ 明確な名前
const searchQuery = 'search query'
const createdAt = new Date()
const shoppingItems: ShoppingItem[] = []
```

### 関数

動詞 + 名詞の形式:

```typescript
// ✅ 良い例
fetchShoppingList()    // データ取得
calculateTotalPrice()  // 計算
validateEmail()        // バリデーション
isValidEmail()         // 真偽値を返す (is/has/can)
formatPrice()          // 変換/フォーマット
handleSubmit()         // イベントハンドラ (handle)
onItemClick()          // コールバック (on)
```

### コンポーネント

```typescript
// ✅ PascalCase
ShoppingListCard.tsx
ItemCheckbox.tsx
FamilyMemberList.tsx
```

### ファイル

```typescript
// コンポーネント: PascalCase
components/ShoppingList.tsx
components/ItemCard.tsx

// ユーティリティ・フック: camelCase
lib/formatPrice.ts
hooks/useShoppingList.ts

// 定数: SCREAMING_SNAKE_CASE (ファイル内)
const MAX_ITEMS_PER_LIST = 100
const API_TIMEOUT_MS = 5000
```

## TypeScript

### 型安全性

```typescript
// ❌ any を使わない
function processData(data: any) { ... }

// ✅ 適切な型を定義
interface ShoppingItem {
  id: string
  name: string
  quantity: number
  checked: boolean
  status: 'pending' | 'purchased' | 'removed'  // リテラル型
}

function processItem(item: ShoppingItem) { ... }
```

### イミュータビリティ

```typescript
// ❌ 直接変更
items.push(newItem)
user.name = 'New Name'

// ✅ スプレッド演算子で新しいオブジェクト/配列を作成
const newItems = [...items, newItem]
const updatedUser = { ...user, name: 'New Name' }

// ✅ 配列操作
const filtered = items.filter(item => !item.checked)
const mapped = items.map(item => ({ ...item, checked: true }))
```

### エラーハンドリング

```typescript
// ✅ try-catch で具体的なエラーメッセージ
async function fetchItems(listId: string): Promise<ShoppingItem[]> {
  try {
    const response = await fetch(`/api/lists/${listId}/items`)

    if (!response.ok) {
      throw new Error(`アイテム取得に失敗: ${response.status}`)
    }

    return response.json()
  } catch (error) {
    if (error instanceof Error) {
      console.error('fetchItems エラー:', error.message)
      throw error
    }
    throw new Error('予期せぬエラーが発生しました')
  }
}
```

### 非同期処理

```typescript
// ✅ 依存関係がなければ並列実行
const [lists, user, settings] = await Promise.all([
  fetchLists(),
  fetchUser(),
  fetchSettings(),
])

// ✅ 依存関係があれば順次実行
const user = await fetchUser()
const lists = await fetchListsForUser(user.id)
```

## React

### コンポーネント設計

```typescript
// ✅ 関数コンポーネント + 型定義
interface ItemCardProps {
  item: ShoppingItem
  onToggle: (id: string) => void
  onDelete: (id: string) => void
}

export function ItemCard({ item, onToggle, onDelete }: ItemCardProps) {
  return (
    <div className="flex items-center gap-2 p-2 border rounded">
      <input
        type="checkbox"
        checked={item.checked}
        onChange={() => onToggle(item.id)}
      />
      <span className={item.checked ? 'line-through' : ''}>
        {item.name}
      </span>
      <button onClick={() => onDelete(item.id)}>
        削除
      </button>
    </div>
  )
}
```

### 状態更新

```typescript
// ❌ 古い参照を使う
setCount(count + 1)
setItems([...items, newItem])

// ✅ 関数形式で最新の状態を参照
setCount(prev => prev + 1)
setItems(prev => [...prev, newItem])
```

### 条件付きレンダリング

```typescript
// ✅ 明確な条件分岐
function ItemList({ items, isLoading, error }: Props) {
  if (isLoading) {
    return <Spinner />
  }

  if (error) {
    return <ErrorMessage message={error.message} />
  }

  if (items.length === 0) {
    return <EmptyState message="アイテムがありません" />
  }

  return (
    <ul>
      {items.map(item => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  )
}
```

### カスタムフック

```typescript
// ✅ 再利用可能なロジックを抽出
function useShoppingList(listId: string) {
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    fetchItems(listId)
      .then(setItems)
      .catch(setError)
      .finally(() => setIsLoading(false))
  }, [listId])

  const addItem = async (name: string) => {
    const newItem = await createItem(listId, name)
    setItems(prev => [...prev, newItem])
  }

  const toggleItem = async (itemId: string) => {
    await updateItem(itemId, { checked: !items.find(i => i.id === itemId)?.checked })
    setItems(prev =>
      prev.map(item =>
        item.id === itemId ? { ...item, checked: !item.checked } : item
      )
    )
  }

  return { items, isLoading, error, addItem, toggleItem }
}
```

## API設計

### レスポンス形式

```typescript
// ✅ 一貫したレスポンス構造
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
  meta?: {
    total: number
    page: number
    limit: number
  }
}

// 成功
return Response.json({
  success: true,
  data: items,
  meta: { total: 100, page: 1, limit: 20 }
})

// エラー
return Response.json({
  success: false,
  error: {
    code: 'VALIDATION_ERROR',
    message: '名前は必須です'
  }
}, { status: 400 })
```

### バリデーション

```typescript
import { z } from 'zod'

const createItemSchema = z.object({
  name: z.string().min(1, '名前は必須です').max(100, '名前は100文字以内'),
  quantity: z.number().int().min(1, '1以上を指定してください').default(1),
})

export async function POST(request: Request) {
  const body = await request.json()
  const result = createItemSchema.safeParse(body)

  if (!result.success) {
    return Response.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: result.error.issues[0].message,
      }
    }, { status: 400 })
  }

  // result.data は型安全
  const item = await createItem(result.data)
  return Response.json({ success: true, data: item }, { status: 201 })
}
```

## ファイル構成

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # Route Handlers（auth, trpc, ogp, e2e）
│   ├── lists/, items/, groups/, history/, tags/, settings/, login/
│   ├── layout.tsx
│   ├── providers.tsx
│   └── page.tsx
├── modules/               # 境界づけられたコンテキスト（catalog / identity / shopping / sync）
│   └── <context>/{domain,application,infrastructure}/
├── infrastructure/
│   ├── auth/              # NextAuth 設定
│   ├── db/drizzle/        # client.ts, schema.ts, migrations/
│   ├── trpc/              # server, client, provider, routers/
│   └── sync/              # SyncEngine
├── components/
│   ├── ui/                # 汎用UI（Button, Input, BottomSheet など）
│   ├── layouts/
│   └── features/          # 機能固有（items, tags, groups, sync, auth）
├── hooks/
│   └── data/              # useItems, useLists など（useDataSource で Dexie / tRPC 切り替え）
├── contexts/              # React Context
├── lib/
│   ├── db/                # Dexie（IndexedDB）
│   └── utils.ts
├── shared/
│   ├── schemas/           # Zod スキーマ
│   └── types/
└── types/                 # 型定義（next-auth.d.ts）
```

## アンチパターン

### ❌ 避けるべき

```typescript
// 50行以上の関数
function doEverything() { /* 100行... */ }

// 5レベル以上のネスト
if (a) {
  if (b) {
    if (c) {
      if (d) {
        if (e) { ... }
      }
    }
  }
}

// マジックナンバー
if (items.length > 50) { ... }

// 説明のない省略名
const u = getUser()
const i = items.find(x => x.id === id)
```

### ✅ 推奨

```typescript
// 小さな関数に分割
function validateInput() { ... }
function processData() { ... }
function formatOutput() { ... }

// 早期リターンでネストを減らす
if (!a) return
if (!b) return
if (!c) return
// メインロジック

// 名前付き定数
const MAX_ITEMS_PER_LIST = 50
if (items.length > MAX_ITEMS_PER_LIST) { ... }

// 明確な変数名
const currentUser = getUser()
const targetItem = items.find(item => item.id === targetId)
```

## コメント

```typescript
// ❌ 「何を」しているかのコメント（コードを見ればわかる）
// ユーザーを取得
const user = getUser()

// ✅ 「なぜ」そうしているかのコメント
// キャッシュを無効化するため、タイムスタンプを付与
const cacheKey = `user:${userId}:${Date.now()}`

// ✅ 複雑なビジネスロジックの説明
// 家族の所有者は削除不可。所有権を移譲してから削除する必要がある
if (member.role === 'owner') {
  throw new Error('所有者は直接削除できません')
}
```
