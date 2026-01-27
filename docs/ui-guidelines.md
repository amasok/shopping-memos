# UI制作ガイドライン

## 1. 基本方針

### 1.1 開発アプローチ
**「べた書き → 必要に応じて切り出し」方式**

- MVPフェーズでは、まずページ単位でべた書き
- 「3回同じコードを書いたら」コンポーネントとして切り出す
- 過度な抽象化より、動くものを早く作ることを優先

### 1.2 コンポーネント設計
Atomic Designを参考にしつつ、シンプルな2層構成を採用。

```
src/components/
├── ui/        # 汎用パーツ（どの機能でも使う）
└── features/  # 機能固有のコンポーネント
```

---

## 2. ディレクトリ構成

```
src/
├── app/                      # Next.js App Router（ページ）
│   ├── page.tsx             # ホーム画面
│   ├── items/
│   │   ├── page.tsx         # アイテム一覧
│   │   └── new/page.tsx     # アイテム追加
│   ├── lists/
│   │   ├── new/page.tsx     # リスト作成
│   │   └── [id]/page.tsx    # 買い物中
│   ├── history/page.tsx     # 購入履歴
│   ├── groups/              # グループ管理
│   └── login/page.tsx       # ログイン
│
├── components/
│   ├── ui/                  # 汎用UIコンポーネント
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Checkbox.tsx
│   │   ├── Badge.tsx
│   │   ├── Modal.tsx
│   │   └── ...
│   │
│   ├── features/            # 機能固有コンポーネント
│   │   ├── items/           # アイテム関連
│   │   │   ├── ItemCard.tsx
│   │   │   └── ItemForm.tsx
│   │   ├── tags/            # タグ関連
│   │   │   └── TagSelector.tsx
│   │   ├── lists/           # リスト関連
│   │   │   └── CheckList.tsx
│   │   └── ...
│   │
│   └── layouts/             # レイアウト
│       ├── Header.tsx
│       ├── BottomNav.tsx
│       └── PageContainer.tsx
│
└── styles/                  # グローバルスタイル
    └── globals.css
```

---

## 3. コンポーネント分類

### 3.1 ui/ - 汎用UIコンポーネント

**特徴:**
- 機能に依存しない
- Props で見た目・振る舞いを制御
- 再利用性が高い

**最初から作るもの:**

| コンポーネント | 用途 |
|---------------|------|
| `Button` | 各種ボタン（variant: primary/secondary/ghost） |
| `Input` | テキスト入力 |
| `Checkbox` | チェックボックス |
| `Badge` | タグ表示用バッジ |
| `Modal` | モーダルダイアログ |
| `PageContainer` | ページ共通レイアウト（余白・最大幅） |
| `EmptyState` | 空状態の表示 |
| `Spinner` | ローディング |

### 3.2 features/ - 機能固有コンポーネント

**特徴:**
- 特定の機能に紐づく
- ドメイン知識を持つ
- 必要になったら作る（最初から作らない）

**例:**
- `ItemCard` - アイテム表示カード
- `TagSelector` - タグ選択UI
- `CheckList` - 買い物中のチェックリスト
- `GroupMemberList` - グループメンバー一覧

### 3.3 layouts/ - レイアウトコンポーネント

**特徴:**
- ページ構造を定義
- ヘッダー、ナビゲーションなど

---

## 4. 切り出しの判断基準

### 切り出すタイミング

| 条件 | アクション |
|------|-----------|
| 同じコードを3回書いた | コンポーネント化を検討 |
| 10行以上のJSXブロック | 切り出しを検討 |
| Props で制御したい | コンポーネント化 |
| テストしたい | コンポーネント化 |

### 切り出さない方がいい場合

| 条件 | 理由 |
|------|------|
| 1箇所でしか使わない | 不要な抽象化 |
| まだ仕様が固まっていない | 早すぎる最適化 |
| 切り出すと Props が複雑になる | 可読性低下 |

---

## 5. 命名規則

### ファイル名
- コンポーネント: `PascalCase.tsx`（例: `ItemCard.tsx`）
- ユーティリティ: `camelCase.ts`（例: `formatDate.ts`）

### コンポーネント名
- 機能を表す名詞（例: `Button`, `ItemCard`, `TagSelector`）
- 動詞は避ける（`ShowItem` → `ItemCard`）

### Props 型
- コンポーネント名 + `Props`（例: `ButtonProps`, `ItemCardProps`）

---

## 6. スタイリング

### 基本方針
- **Tailwind CSS** を使用
- インラインで className を記述
- 複雑な場合は `cn()` ユーティリティで結合

### 例

```tsx
// シンプルな場合
<button className="px-4 py-2 bg-blue-500 text-white rounded">
  保存
</button>

// バリエーションがある場合
import { cn } from '@/lib/utils'

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost'
  children: React.ReactNode
}

export function Button({ variant = 'primary', children }: ButtonProps) {
  return (
    <button
      className={cn(
        'px-4 py-2 rounded font-medium',
        variant === 'primary' && 'bg-blue-500 text-white',
        variant === 'secondary' && 'bg-gray-200 text-gray-800',
        variant === 'ghost' && 'bg-transparent text-gray-600'
      )}
    >
      {children}
    </button>
  )
}
```

---

## 7. レスポンシブ対応

### ブレークポイント
- モバイルファースト
- Tailwind のデフォルトブレークポイントを使用

| 接頭辞 | 最小幅 | 対象 |
|--------|--------|------|
| (なし) | 0px | モバイル |
| `sm` | 640px | 大きめのスマホ |
| `md` | 768px | タブレット |
| `lg` | 1024px | PC |

### 例

```tsx
<div className="p-4 md:p-6 lg:p-8">
  <h1 className="text-xl md:text-2xl">タイトル</h1>
</div>
```

---

## 8. アクセシビリティ

### 必須事項
- タッチターゲット: 最低 44x44px
- フォーカス表示: `focus:ring-2 focus:ring-blue-500`
- セマンティックHTML: `<button>`, `<nav>`, `<main>` など適切なタグ
- aria属性: 必要に応じて追加

### 例

```tsx
<button
  className="min-h-[44px] min-w-[44px] focus:ring-2 focus:ring-blue-500 focus:outline-none"
  aria-label="アイテムを追加"
>
  <PlusIcon />
</button>
```

---

## 9. 開発フロー

### Phase 1: MVP（べた書き中心）

1. ページを作成（`app/xxx/page.tsx`）
2. 最低限の ui/ コンポーネントを使う
3. ページ内にべた書きで実装
4. 動作確認

### Phase 2: リファクタリング

1. 重複コードを特定
2. features/ に切り出し
3. 既存ページを置き換え
4. テスト追加

---

## 10. チェックリスト

### 新規ページ作成時
- [ ] PageContainer でラップ
- [ ] 空状態（EmptyState）を考慮
- [ ] ローディング状態を考慮
- [ ] エラー状態を考慮
- [ ] モバイルで確認

### コンポーネント作成時
- [ ] Props の型定義
- [ ] デフォルト値の設定
- [ ] アクセシビリティ対応
- [ ] Storybook に追加（Phase 2）

---

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2025-01-27 | 初版作成 |
