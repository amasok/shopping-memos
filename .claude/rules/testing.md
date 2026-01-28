# テスト規約

## カバレッジ基準

**最低80%のテストカバレッジを維持する**

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
  },
})
```

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

APIエンドポイント・データベース操作をテスト。

```typescript
// src/app/api/items/__tests__/route.test.ts
describe('POST /api/items', () => {
  it('新しいアイテムを作成する', async () => {
    const request = new Request('http://localhost/api/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'テスト', quantity: 1 }),
    })

    const response = await POST(request)

    expect(response.status).toBe(201)
    const data = await response.json()
    expect(data.name).toBe('テスト')
  })
})
```

### 3. E2Eテスト

重要なユーザーフローをPlaywrightでテスト。

```typescript
// e2e/shopping-list.spec.ts
test('買い物リストにアイテムを追加できる', async ({ page }) => {
  await page.goto('/lists/1')
  await page.fill('[data-testid="item-input"]', '牛乳')
  await page.click('[data-testid="add-button"]')

  await expect(page.locator('[data-testid="item-list"]')).toContainText('牛乳')
})
```

## TDDワークフロー

```
1. RED    - 失敗するテストを書く
2. GREEN  - テストを通す最小限のコードを書く
3. REFACTOR - コードを改善（テストは通ったまま）
4. VERIFY - カバレッジ80%以上を確認
```

### 手順

```bash
# 1. テストを書く
# 2. テストが失敗することを確認
npm test -- --watch

# 3. 実装を書く
# 4. テストが通ることを確認

# 5. カバレッジを確認
npm test -- --coverage
```

## テストが失敗した場合

### 原則: 実装を直す、テストを直すな

```
❌ テストを修正してパスさせる
✅ 実装を修正してテストを通す
```

**例外: テスト自体にバグがある場合のみテストを修正**

### トラブルシューティング

1. **テストの独立性を確認**
   - 他のテストに依存していないか
   - beforeEach で初期化されているか

2. **モックの正確性を確認**
   - 期待値が正しいか
   - モックの戻り値が適切か

3. **非同期処理の確認**
   - await が適切に使われているか
   - タイムアウトが十分か

## テストファイル構成

```
src/
├── lib/
│   ├── utils.ts
│   └── __tests__/
│       └── utils.test.ts
├── components/
│   ├── ItemCard.tsx
│   └── __tests__/
│       └── ItemCard.test.tsx
└── app/
    └── api/
        └── items/
            ├── route.ts
            └── __tests__/
                └── route.test.ts

e2e/
├── auth.spec.ts
├── shopping-list.spec.ts
└── fixtures/
    └── test-data.ts
```

## テスト命名規則

```typescript
// ✅ 良い例: 期待する動作を説明
it('空の名前でバリデーションエラーを返す', () => {})
it('認証済みユーザーのみアクセスできる', () => {})
it('アイテムをチェックすると取り消し線が表示される', () => {})

// ❌ 悪い例: 曖昧な名前
it('test1', () => {})
it('should work', () => {})
it('エラー', () => {})
```

## モック

### Drizzleのモック

```typescript
// src/test/__mocks__/db.ts
import { vi } from 'vitest'

export const dbMock = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})
```

### 使用例

```typescript
import { dbMock } from '@/test/__mocks__/db'

vi.mock('@/infrastructure/db/drizzle/client', () => ({
  db: dbMock,
}))

it('ユーザーを取得する', async () => {
  const mockUser = { id: '1', name: 'テスト', email: 'test@example.com' }
  dbMock.returning.mockResolvedValue([mockUser])

  const result = await getUserById('1')

  expect(result).toEqual(mockUser)
})
```

## 対応エージェント

- **tdd-guide**: TDDワークフローの支援
- **e2e-runner**: E2Eテストの作成・実行
