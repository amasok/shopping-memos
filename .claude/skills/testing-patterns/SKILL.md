---
name: testing-patterns
description: Vitest のユニット・統合テスト、Playwright の E2E テスト、Drizzle のモック、テストファイル配置の例。テストを書くとき・失敗したテストを調べるときに使う。
---

# テストパターン

ルール（必須事項）は `.claude/rules/testing.md`。ここはコード例集。

## テストの種類

### 1. ユニットテスト

個々の関数・コンポーネントをテスト。

```typescript
// src/lib/__tests__/utils.test.ts
describe('formatPrice', () => {
  it('数値を日本円形式でフォーマットする', () => {
    expect(formatPrice(1000)).toBe('¥1,000')
  })

  it('0を正しく処理する', () => {
    expect(formatPrice(0)).toBe('¥0')
  })

  it('負の数を処理する', () => {
    expect(formatPrice(-100)).toBe('-¥100')
  })
})
```

### 2. 統合テスト

Route Handler や Zod スキーマ、リポジトリ（Drizzle をモック）をテスト。

```typescript
// src/app/api/ogp/__tests__/route.test.ts
import { NextRequest } from 'next/server'
import { GET } from '../route'

it('url パラメータがない場合は 400 を返す', async () => {
  const res = await GET(new NextRequest('http://localhost/api/ogp'))
  expect(res.status).toBe(400)
})
```

```typescript
// src/shared/schemas/__tests__/item.test.ts
import { createItemSchema } from '../item'

it('空の名前を拒否する', () => {
  expect(createItemSchema.safeParse({ name: '', quantity: 1 }).success).toBe(false)
})
```

### 3. E2Eテスト

重要なユーザーフローをPlaywrightでテスト。データは `e2e/fixtures/test-helpers.ts` の IndexedDB ヘルパーで用意し、要素は `data-testid` で取得する。

```typescript
// e2e/shopping-list.spec.ts
test('買い物リストにアイテムを追加できる', async ({ page }) => {
  await page.goto('/lists/1')
  await page.fill('[data-testid="item-input"]', '牛乳')
  await page.click('[data-testid="add-button"]')

  await expect(page.locator('[data-testid="item-list"]')).toContainText('牛乳')
})
```

## テストファイル構成

```
src/
├── modules/<context>/__tests__/        # ドメイン・アプリケーション層
├── shared/schemas/__tests__/           # Zod スキーマ
├── hooks/data/__tests__/               # データフック（useDataSource など）
├── components/<dir>/__tests__/         # コンポーネント
└── app/api/<route>/__tests__/          # Route Handler

e2e/
├── *.spec.ts                           # ゲストモード（IndexedDB を page.evaluate で操作）
├── auth/                               # ログインが必要なテスト（auth.setup.ts で storageState 保存）
└── fixtures/{test-helpers,test-data}.ts
```

## Drizzle のモック

`vi.mock` はファイル先頭に巻き上げられるため、モックオブジェクトは `vi.hoisted` で定義する。

```typescript
import { vi } from 'vitest'

const dbMock = vi.hoisted(() => ({
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
}))

vi.mock('@/infrastructure/db/drizzle/client', () => ({ db: dbMock }))

beforeEach(() => {
  vi.clearAllMocks()
})

it('存在しない ID の場合は null を返す', async () => {
  dbMock.where.mockResolvedValue([])
  const { itemRepository } = await import(
    '@/modules/catalog/infrastructure/repositories/DrizzleItemRepository'
  )
  expect(await itemRepository.findById('missing')).toBeNull()
})
```

## テストが失敗したときの確認

1. **テストの独立性を確認**
   - 他のテストに依存していないか
   - beforeEach で初期化されているか

2. **モックの正確性を確認**
   - 期待値が正しいか
   - モックの戻り値が適切か

3. **非同期処理の確認**
   - await が適切に使われているか
   - タイムアウトが十分か

