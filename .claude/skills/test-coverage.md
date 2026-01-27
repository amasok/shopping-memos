---
name: test-coverage
description: テストカバレッジを分析し、不足している箇所のテストを生成。80%以上を目標。/test-coverage で実行。
tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob"]
---

# /test-coverage - テストカバレッジ改善

テストカバレッジを分析し、不足している箇所を特定してテストを生成する。

## コマンド

```
/test-coverage           - カバレッジ分析と改善提案
/test-coverage report    - カバレッジレポートのみ表示
/test-coverage improve   - 不足箇所のテストを自動生成
/test-coverage <ファイル> - 特定ファイルのカバレッジを改善
```

## ワークフロー

### 1. カバレッジ計測

```bash
npm test -- --coverage --coverageReporters=json-summary
```

### 2. レポート分析

`coverage/coverage-summary.json` を解析:

```json
{
  "total": {
    "lines": { "pct": 75.5 },
    "statements": { "pct": 74.2 },
    "functions": { "pct": 80.1 },
    "branches": { "pct": 68.3 }
  },
  "src/lib/utils.ts": {
    "lines": { "pct": 45.0 },
    "branches": { "pct": 30.0 }
  }
}
```

### 3. 不足箇所の特定

80%未満のファイルをリストアップ:

```
カバレッジ不足ファイル:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ファイル                    行    分岐
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
src/lib/utils.ts           45%   30%  ⚠️
src/components/Modal.tsx   62%   55%  ⚠️
src/app/api/items/route.ts 70%   65%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
全体                       75%   68%  ⚠️ 目標: 80%
```

### 4. テスト生成戦略

各ファイルについて:

1. **未テストの関数を特定**
   ```bash
   # カバレッジ詳細から未カバー行を抽出
   cat coverage/lcov-report/src/lib/utils.ts.html
   ```

2. **テストケースを設計**
   - 正常系: 標準的な入力での動作
   - 異常系: エラー処理
   - 境界値: null, undefined, 空配列, 最大値
   - エッジケース: 特殊文字, Unicode

3. **テストコードを生成**

## テスト生成テンプレート

### ユーティリティ関数

```typescript
// src/lib/__tests__/utils.test.ts
import { formatPrice, validateEmail } from '../utils'

describe('formatPrice', () => {
  // 正常系
  it('正の数値をフォーマットする', () => {
    expect(formatPrice(1000)).toBe('¥1,000')
  })

  // 境界値
  it('0を処理する', () => {
    expect(formatPrice(0)).toBe('¥0')
  })

  it('小数を切り捨てる', () => {
    expect(formatPrice(100.99)).toBe('¥100')
  })

  // 異常系
  it('負の数値を処理する', () => {
    expect(formatPrice(-100)).toBe('-¥100')
  })

  it('NaNでエラーを投げる', () => {
    expect(() => formatPrice(NaN)).toThrow()
  })
})
```

### APIルート

```typescript
// src/app/api/items/__tests__/route.test.ts
import { GET, POST } from '../route'

describe('GET /api/items', () => {
  it('アイテム一覧を返す', async () => {
    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  it('認証エラーで401を返す', async () => {
    // 認証なしでリクエスト
    const response = await GET()
    expect(response.status).toBe(401)
  })
})

describe('POST /api/items', () => {
  it('新しいアイテムを作成する', async () => {
    const request = new Request('http://localhost/api/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'テスト', quantity: 1 }),
    })

    const response = await POST(request)
    expect(response.status).toBe(201)
  })

  it('バリデーションエラーで400を返す', async () => {
    const request = new Request('http://localhost/api/items', {
      method: 'POST',
      body: JSON.stringify({ name: '' }), // 空の名前
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })
})
```

## カバレッジ目標

```javascript
// jest.config.js
module.exports = {
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
}
```

## 改善レポート

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
テストカバレッジ改善レポート
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

改善前: 75.5%
改善後: 84.2% (+8.7%)

追加したテスト:
  ✅ src/lib/__tests__/utils.test.ts (12 cases)
  ✅ src/app/api/items/__tests__/route.test.ts (8 cases)

カバレッジ変化:
  src/lib/utils.ts:           45% → 92% (+47%)
  src/app/api/items/route.ts: 70% → 88% (+18%)

目標達成: ✅ 80%以上
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
