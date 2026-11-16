---
name: frontend-patterns
description: React/Next.jsのフロントエンドパターン集。コンポーネント設計、状態管理、パフォーマンス最適化のベストプラクティス。
tools: ["Read", "Write", "Edit", "Glob"]
---

# フロントエンドパターン

React/Next.js でのフロントエンド開発パターン集。

## コンポーネント設計

### Compound Components (複合コンポーネント)

関連するコンポーネントをContextで結合:

```typescript
// src/components/Card/index.tsx
'use client'

import { createContext, useContext, ReactNode } from 'react'

interface CardContextType {
  variant: 'default' | 'outlined'
}

const CardContext = createContext<CardContextType | null>(null)

function useCardContext() {
  const context = useContext(CardContext)
  if (!context) throw new Error('Card.* must be used within Card')
  return context
}

interface CardProps {
  children: ReactNode
  variant?: 'default' | 'outlined'
}

export function Card({ children, variant = 'default' }: CardProps) {
  return (
    <CardContext.Provider value={{ variant }}>
      <div className={`rounded-lg ${variant === 'outlined' ? 'border' : 'bg-white shadow'}`}>
        {children}
      </div>
    </CardContext.Provider>
  )
}

export function CardHeader({ children }: { children: ReactNode }) {
  return <div className="p-4 border-b">{children}</div>
}

export function CardBody({ children }: { children: ReactNode }) {
  return <div className="p-4">{children}</div>
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <div className="p-4 border-t bg-gray-50">{children}</div>
}

// 使用例
// <Card variant="outlined">
//   <Card.Header>タイトル</Card.Header>
//   <Card.Body>内容</Card.Body>
//   <Card.Footer>アクション</Card.Footer>
// </Card>
```

### Render Props

柔軟なレンダリングロジック:

```typescript
// src/components/DataLoader.tsx
interface DataLoaderProps<T> {
  url: string
  children: (data: T, loading: boolean, error: Error | null) => ReactNode
}

export function DataLoader<T>({ url, children }: DataLoaderProps<T>) {
  const { data, loading, error } = useFetch<T>(url)
  return <>{children(data as T, loading, error)}</>
}

// 使用例
// <DataLoader<User[]> url="/api/users">
//   {(users, loading, error) => (
//     loading ? <Spinner /> :
//     error ? <Error message={error.message} /> :
//     <UserList users={users} />
//   )}
// </DataLoader>
```

## カスタムフック

### useToggle

```typescript
// src/hooks/useToggle.ts
import { useState, useCallback } from 'react'

export function useToggle(initialValue = false) {
  const [value, setValue] = useState(initialValue)

  const toggle = useCallback(() => setValue(v => !v), [])
  const setTrue = useCallback(() => setValue(true), [])
  const setFalse = useCallback(() => setValue(false), [])

  return { value, toggle, setTrue, setFalse }
}

// 使用例
// const { value: isOpen, toggle, setFalse: close } = useToggle()
```

### useDebounce

```typescript
// src/hooks/useDebounce.ts
import { useState, useEffect } from 'react'

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

// 使用例
// const debouncedSearch = useDebounce(searchTerm, 300)
```

### useLocalStorage

```typescript
// src/hooks/useLocalStorage.ts
import { useState, useEffect } from 'react'

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch {
      return initialValue
    }
  })

  const setValue = (value: T | ((val: T) => T)) => {
    const valueToStore = value instanceof Function ? value(storedValue) : value
    setStoredValue(valueToStore)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, JSON.stringify(valueToStore))
    }
  }

  return [storedValue, setValue] as const
}
```

## パフォーマンス最適化

### React.memo

```typescript
// 高コストなコンポーネントをメモ化
const ExpensiveList = memo(function ExpensiveList({ items }: { items: Item[] }) {
  return (
    <ul>
      {items.map(item => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  )
})

// propsが変わらない限り再レンダリングしない
```

### useMemo / useCallback

```typescript
// 計算結果をメモ化
const sortedItems = useMemo(
  () => items.sort((a, b) => a.name.localeCompare(b.name)),
  [items]
)

// コールバックをメモ化
const handleClick = useCallback((id: string) => {
  setSelectedId(id)
}, [])
```

### 動的インポート (Code Splitting)

```typescript
// 重いコンポーネントを遅延読み込み
import dynamic from 'next/dynamic'

const HeavyChart = dynamic(() => import('@/components/HeavyChart'), {
  loading: () => <Skeleton />,
  ssr: false, // クライアントのみ
})
```

## フォーム処理

### Controlled Component

```typescript
// src/components/ItemForm.tsx
'use client'

import { useState } from 'react'

interface ItemFormProps {
  onSubmit: (data: { name: string; quantity: number }) => void
}

export function ItemForm({ onSubmit }: ItemFormProps) {
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = () => {
    const newErrors: Record<string, string> = {}
    if (!name.trim()) newErrors.name = '名前を入力してください'
    if (quantity < 1) newErrors.quantity = '1以上を入力してください'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (validate()) {
      onSubmit({ name: name.trim(), quantity })
      setName('')
      setQuantity(1)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="アイテム名"
          aria-invalid={!!errors.name}
        />
        {errors.name && <span className="text-red-500">{errors.name}</span>}
      </div>

      <div>
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
          min={1}
          aria-invalid={!!errors.quantity}
        />
        {errors.quantity && <span className="text-red-500">{errors.quantity}</span>}
      </div>

      <button type="submit">追加</button>
    </form>
  )
}
```

## エラーバウンダリ

```typescript
// src/components/ErrorBoundary.tsx
'use client'

import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-4 bg-red-50 rounded">
          <h2 className="text-red-800">エラーが発生しました</h2>
          <p className="text-red-600">{this.state.error?.message}</p>
        </div>
      )
    }
    return this.props.children
  }
}
```

## Server Components vs Client Components

### Server Component (デフォルト)

> このプロジェクトのページはゲストモード（IndexedDB）対応のためクライアントコンポーネント中心で、
> データは `src/hooks/data` のフック経由で取得する。Server Component は静的ページ（`privacy`、`terms`）などに使う。

```typescript
// 'use client' なし = Server Component（一般的な例）

import { db } from '@/infrastructure/db/drizzle/client'
import { items } from '@/infrastructure/db/drizzle/schema'

export default async function ItemsPage() {
  // サーバーで直接DB取得（クライアントにコードが送られない）
  const rows = await db.select().from(items).limit(100)

  return (
    <ul>
      {rows.map(item => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  )
}
```

### Client Component (インタラクティブ)

```typescript
// src/components/ItemCheckbox.tsx
'use client' // インタラクティブな機能が必要

import { useState } from 'react'

export function ItemCheckbox({ id, initialChecked }: {
  id: string
  initialChecked: boolean
}) {
  const [checked, setChecked] = useState(initialChecked)

  const handleChange = async () => {
    setChecked(!checked)
    await fetch(`/api/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ checked: !checked }),
    })
  }

  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={handleChange}
    />
  )
}
```

## ディレクトリ構造

```
src/
├── components/
│   ├── ui/              # 汎用UIコンポーネント
│   │   ├── Button.tsx
│   │   ├── Card/
│   │   │   └── index.tsx
│   │   └── Modal.tsx
│   └── features/        # 機能固有コンポーネント
│       ├── items/
│       └── family/
├── hooks/               # カスタムフック
│   ├── useToggle.ts
│   └── useDebounce.ts
└── lib/                 # ユーティリティ
    └── utils.ts
```
