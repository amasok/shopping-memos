# アーキテクチャ学習ガイド

このプロジェクトの構成を理解するための実践的なガイド。各セクションで「何をしているか」「どのファイルを見るか」「関連するNext.jsの概念」をまとめている。

---

## 全体像

```
ユーザー
  ↓
React Components (クライアント)
  ↓
hooks/data/ → データソース判定（ログイン有無で切り替え）
  ├── 未ログイン → Dexie (IndexedDB)  ← ブラウザ内で完結
  └── ログイン済 → tRPC → Next.js API Route → Drizzle ORM → PostgreSQL (Neon)
```

**オフラインファースト**: 未ログインでもローカルDBだけで動作する。ログイン後にサーバーと同期。

---

## 1. フロントエンド

### 1.1 ページとルーティング（App Router）

Next.js の App Router を使用。`src/app/` 配下のディレクトリ構造がそのままURLになる。

| URL | ファイル | 内容 |
|-----|---------|------|
| `/` | `src/app/page.tsx` | 買いたいものリスト（トップ） |
| `/lists/[id]` | `src/app/lists/[id]/page.tsx` | 買い物リスト詳細 |
| `/history` | `src/app/history/page.tsx` | 購入履歴 |
| `/tags` | `src/app/tags/page.tsx` | タグ管理 |
| `/groups` | `src/app/groups/page.tsx` | グループ管理 |
| `/settings` | `src/app/settings/page.tsx` | 設定 |
| `/login` | `src/app/login/page.tsx` | ログイン |

**学ぶポイント**:
- `page.tsx` がそのルートの画面コンポーネント
- `layout.tsx` が共通レイアウト（`src/app/layout.tsx` がルート）
- `[id]` は動的ルート（URLパラメータ）
- 参考: [Next.js App Router](https://nextjs.org/docs/app/building-your-application/routing)

### 1.2 コンポーネント構成

```
src/components/
├── ui/           # 汎用UI部品（ボタン、入力欄、チェックボックスなど）
├── features/     # 機能別コンポーネント（ドメインロジックを含む）
│   ├── auth/     # 認証（ログイン促進バナー）
│   ├── groups/   # グループ選択
│   ├── items/    # アイテムフォーム、選択
│   ├── sync/     # データマージ状態
│   └── tags/     # タグフィルター
├── layouts/      # レイアウト（AppLayout, Header）
└── pwa/          # PWA（Service Worker登録）
```

**読む順番**:
1. `src/components/ui/Button.tsx` - 最もシンプルなUIコンポーネント
2. `src/components/layouts/AppLayout.tsx` - ページ共通レイアウト
3. `src/components/features/items/ItemForm.tsx` - フォーム処理の例

**学ぶポイント**:
- `"use client"` ディレクティブ: このプロジェクトでは全ページがクライアントコンポーネント（オフライン対応のため）
- 参考: [Server and Client Components](https://nextjs.org/docs/app/building-your-application/rendering/client-components)

### 1.3 状態管理

外部ライブラリ（Redux等）は使わず、React Context API で管理。

| Context | ファイル | 役割 |
|---------|---------|------|
| AuthContext | `src/contexts/AuthContext.tsx` | ログイン状態 |
| GroupContext | `src/contexts/GroupContext.tsx` | 選択中のグループ |
| SyncContext | `src/contexts/SyncContext.tsx` | サーバー同期状態 |
| DataMergeContext | `src/contexts/DataMergeContext.tsx` | ローカル→サーバーのデータマージ |
| ThemeContext | `src/contexts/ThemeContext.tsx` | テーマ設定 |

**Provider の入れ子**（`src/app/providers.tsx`）:
```
ThemeProvider
  └─ TRPCProvider (React Query)
      └─ AuthProvider (NextAuth SessionProvider)
          └─ DataMergeProvider
              └─ GroupProvider
                  └─ DBProvider (Dexie)
```

**読む順番**:
1. `src/contexts/AuthContext.tsx` - シンプルなContext例
2. `src/contexts/GroupContext.tsx` - ローカルストレージとの連携例
3. `src/app/providers.tsx` - 全Providerの組み立て方

**学ぶポイント**:
- Context = グローバルステート。Props のバケツリレーを避ける仕組み
- 参考: [React Context](https://react.dev/learn/passing-data-deeply-with-context)

### 1.4 データ取得フック

`src/hooks/data/` にデータ取得・更新のカスタムフックを集約。

| フック | ファイル | 役割 |
|-------|---------|------|
| useDataSource | `src/hooks/data/useDataSource.ts` | サーバー/ローカルの切り替え判定 |
| useItems | `src/hooks/data/useItems.ts` | アイテム一覧取得 |
| useItemMutations | `src/hooks/data/useItemMutations.ts` | アイテムCRUD操作 |
| useTags | `src/hooks/data/useTags.ts` | タグ一覧取得 |
| useLists | `src/hooks/data/useLists.ts` | リスト一覧取得 |

**データフローの例**（アイテム一覧取得）:
```
ページコンポーネント
  → useItems()
    → useDataSource() でログイン状態を確認
      ├── ログイン済 → trpc.catalog.getItems.useQuery() → サーバーから取得
      └── 未ログイン → useLiveQuery(() => db.items.toArray()) → IndexedDBから取得
```

**読む順番**:
1. `src/hooks/data/useDataSource.ts` - データソース切り替えの仕組み
2. `src/hooks/data/useItems.ts` - 実際の使用例
3. `src/hooks/data/useItemMutations.ts` - 更新操作の例

### 1.5 スタイリング

- **Tailwind CSS 4** を使用。クラス名でスタイルを指定する
- `clsx` + `tailwind-merge` でクラス名の結合
- ユーティリティ: `src/lib/utils.ts` の `cn()` 関数

```tsx
// 使用例
<div className={cn("p-4 rounded-lg", isActive && "bg-blue-100")}>
```

参考: [Tailwind CSS](https://tailwindcss.com/docs)

---

## 2. バックエンド

### 2.1 API層（tRPC）

REST APIではなく **tRPC** を使用。クライアントとサーバーで型を共有し、型安全なAPI通信を実現。

```
src/infrastructure/trpc/
├── init.ts          # tRPC初期化、プロシージャ定義
├── routers/
│   ├── index.ts     # ルートルーター（全ルーターを結合）
│   ├── identity.ts  # グループ・招待関連
│   ├── catalog.ts   # アイテム・タグ関連
│   ├── shopping.ts  # 買い物リスト・履歴関連
│   └── sync.ts      # データ同期
└── middleware/
    └── groupAuth.ts # グループメンバーシップ検証
```

**エントリーポイント**: `src/app/api/trpc/[trpc]/route.ts`
- Next.js の API Route（Catch-all Route）で、すべてのtRPCリクエストを受ける

**読む順番**:
1. `src/infrastructure/trpc/init.ts` - tRPCの基本設定、publicProcedure/protectedProcedure
2. `src/infrastructure/trpc/routers/catalog.ts` - ルーター実装例（CRUD）
3. `src/infrastructure/trpc/middleware/groupAuth.ts` - ミドルウェアの例

**学ぶポイント**:
- `publicProcedure`: 認証不要のAPI
- `protectedProcedure`: 認証必須のAPI（ログインしていないとエラー）
- `.input()` で入力バリデーション（Zodスキーマ）
- `.query()` で読み取り、`.mutation()` で書き込み
- 参考: [tRPC](https://trpc.io/docs)

### 2.2 認証（NextAuth / Auth.js）

Google OAuth によるログイン。

| ファイル | 役割 |
|---------|------|
| `src/infrastructure/auth/index.ts` | NextAuth設定（プロバイダー、コールバック） |
| `src/app/api/auth/[...nextauth]/route.ts` | 認証APIエンドポイント |
| `src/contexts/AuthContext.tsx` | クライアント側の認証状態管理 |
| `src/app/login/page.tsx` | ログイン画面 |

**認証フロー**:
```
ユーザー → Googleログインボタン → Google OAuth → コールバック → JWT発行 → セッション確立
```

**学ぶポイント**:
- JWT戦略: セッション情報をトークンに含めてDBアクセスを減らす
- Drizzle Adapter: ユーザー/アカウント/セッションをDBに保存
- 参考: [Auth.js](https://authjs.dev/getting-started)

### 2.3 データベース（Drizzle ORM + PostgreSQL）

SQL風のクエリビルダー。Prismaより軽量でSQL寄り。

| ファイル | 役割 |
|---------|------|
| `src/infrastructure/db/drizzle/schema.ts` | テーブル定義（全テーブル） |
| `src/infrastructure/db/drizzle/client.ts` | DB接続設定 |
| `src/infrastructure/db/drizzle/migrations/` | マイグレーションファイル（SQL） |
| `drizzle.config.ts` | Drizzle CLI設定 |

**主要テーブル**:
```
Identity:  users, accounts, sessions, groups, group_members, invite_links
Catalog:   items, tags, item_tags
Shopping:  shopping_lists, list_items
Sync:      sync_operations
```

**読む順番**:
1. `src/infrastructure/db/drizzle/schema.ts` - スキーマ定義（これが一番重要）
2. `src/infrastructure/db/drizzle/client.ts` - DB接続の仕組み
3. `drizzle.config.ts` - マイグレーション設定

**よく使うコマンド**:
```bash
npm run db:generate   # スキーマ変更からマイグレーションSQL生成
npm run db:migrate    # マイグレーション実行（本番向け）
npm run db:push       # スキーマを直接DBに反映（開発向け）
npm run db:studio     # DBブラウザを起動
```

**学ぶポイント**:
- `pgTable()` でテーブル定義、`text()`, `integer()`, `timestamp()` でカラム定義
- `references()` で外部キー
- `index()` でインデックス
- 参考: [Drizzle ORM](https://orm.drizzle.team/docs/overview)

### 2.4 ドメイン層（DDD）

ビジネスロジックを `src/modules/` に配置。ドメイン駆動設計（DDD）の構造。

```
src/modules/
├── identity/        # 認証・グループ管理
├── catalog/         # アイテム・タグ
├── shopping/        # 買い物リスト・履歴
└── sync/            # データ同期
```

各モジュールの内部構造:
```
modules/<context>/
├── domain/               # ドメイン層（ビジネスルール）
│   ├── entities/         # エンティティ（ID付きオブジェクト）
│   ├── repositories/     # リポジトリのインターフェース
│   └── value-objects/    # 値オブジェクト（不変の値）
├── application/
│   └── services/         # アプリケーションサービス（ユースケース）
└── infrastructure/
    └── repositories/     # リポジトリの実装（Drizzle使用）
```

**読む順番**（Shoppingコンテキストが最もわかりやすい）:
1. `src/modules/shopping/domain/entities/ShoppingList.ts` - エンティティとは何か
2. `src/modules/shopping/domain/value-objects/ListStatus.ts` - 値オブジェクトとは何か
3. `src/modules/shopping/domain/repositories/ShoppingListRepository.ts` - リポジトリインターフェース
4. `src/modules/shopping/infrastructure/repositories/DrizzleShoppingListRepository.ts` - 実装
5. `src/modules/shopping/application/services/ShoppingService.ts` - ユースケース

**学ぶポイント**:
- リポジトリパターン: インターフェースと実装を分離。DBを差し替えてもドメイン層は変わらない
- エンティティ: `create()` で新規生成、`reconstitute()` でDBから復元
- 参考: [ドメイン駆動設計入門](https://www.amazon.co.jp/dp/479815072X)

---

## 3. クライアントDB（Dexie / IndexedDB）

未ログイン時のデータ保存先。ブラウザ内のNoSQLデータベース。

| ファイル | 役割 |
|---------|------|
| `src/lib/db/index.ts` | Dexie DBクラス定義、テーブル定義、マイグレーション |

**サーバーDBとの違い**:
- サーバー: PostgreSQL（リレーショナル、正規化）
- クライアント: IndexedDB（NoSQL、非正規化、`tagIds[]` を直接配列で持つ）

**参考**: [Dexie.js](https://dexie.org/docs/)

---

## 4. データ同期

ログイン後にローカルデータをサーバーにマージする仕組み。

| ファイル | 役割 |
|---------|------|
| `src/infrastructure/sync/` | 同期エンジン |
| `src/contexts/DataMergeContext.tsx` | マージ状態管理 |
| `src/contexts/SyncContext.tsx` | 同期状態管理 |
| `src/infrastructure/trpc/routers/sync.ts` | 同期API |

**フロー**:
```
初回ログイン → ローカルデータ収集 → サーバーにアップロード → マージ → 以降サーバー優先
```

---

## 5. PWA（Progressive Web App）

アプリとしてインストール可能にする仕組み。

| ファイル | 役割 |
|---------|------|
| `src/components/pwa/RegisterSW.tsx` | Service Worker登録 |
| `public/manifest.webmanifest` | PWAマニフェスト |

参考: [PWA](https://web.dev/progressive-web-apps/)

---

## 6. バリデーション（Zod）

入力値の検証スキーマを `src/shared/schemas/` で定義し、フロントエンド・バックエンドで共有。

```
src/shared/schemas/
├── item.ts     # アイテムのバリデーション
├── tag.ts      # タグのバリデーション
└── ...
```

**tRPCでの使用例**:
```typescript
.input(z.object({
  name: z.string().min(1).max(100),
  quantity: z.number().int().positive(),
}))
```

参考: [Zod](https://zod.dev/)

---

## 7. テスト

| 種類 | ツール | 場所 |
|------|--------|------|
| ユニットテスト | Vitest | `src/**/__tests__/*.test.ts` |
| E2Eテスト | Playwright | `e2e/*.spec.ts` |

```bash
npm run test:run      # ユニットテスト実行
npm run test:coverage # カバレッジ付き
npm run test:e2e      # E2Eテスト実行
```

参考: [Vitest](https://vitest.dev/) / [Playwright](https://playwright.dev/)

---

## 8. 設定ファイル一覧

| ファイル | 役割 |
|---------|------|
| `next.config.ts` | Next.js設定 |
| `drizzle.config.ts` | Drizzle ORM CLI設定 |
| `tsconfig.json` | TypeScript設定（`@/*` パスエイリアス） |
| `tailwind.config.ts` | Tailwind CSS設定 |
| `vitest.config.ts` | テスト設定 |
| `playwright.config.ts` | E2Eテスト設定 |
| `.env.local` | 環境変数（gitignore対象） |

---

## 9. 推奨する学習順序

### Step 1: ページの流れを追う
1. `src/app/page.tsx` を開く（トップページ）
2. どのコンポーネントを使っているか追う
3. データをどう取得しているか（`useItems` 等）を追う

### Step 2: データフローを理解する
1. `src/hooks/data/useDataSource.ts` - サーバー/ローカルの判定
2. `src/hooks/data/useItems.ts` - データ取得の実装
3. `src/infrastructure/trpc/routers/catalog.ts` - サーバー側の処理

### Step 3: バックエンドを理解する
1. `src/infrastructure/db/drizzle/schema.ts` - テーブル構造
2. `src/modules/shopping/` - DDDパターンの実例
3. `src/infrastructure/trpc/init.ts` - 認証の仕組み

### Step 4: 同期を理解する
1. `src/contexts/DataMergeContext.tsx` - マージの流れ
2. `src/infrastructure/sync/` - 同期エンジン

---

## 10. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 初期設計書（DDD構造、CQRS方針、セキュリティ） |
| [PRD.md](./PRD.md) | プロダクト要件定義 |
| [ui-guidelines.md](./ui-guidelines.md) | UIデザインガイドライン |
| [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) | インフラ構成 |
| [docs/adr/](./adr/) | アーキテクチャ決定記録（ADR） |
