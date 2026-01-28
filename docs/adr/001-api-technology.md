# ADR-001: API技術選定（tRPC + Server Actions）

## ステータス

**承認済み**

## コンテキスト

買い物メモアプリのバックエンドAPIを実装する技術を選定する必要がある。

### 現状
- フロントエンド: Next.js 16 App Router + React 19 + TypeScript
- ローカルDB: Dexie (IndexedDB)
- サーバーDB: PostgreSQL (Drizzle ORM)
- 認証: NextAuth（設定済み）
- コード規模: ~20kLOC、53ファイル

### 要件
1. TypeScriptとの高い親和性
2. Next.js App Routerとの統合
3. 学習コストの最小化（個人開発）
4. オフラインファースト設計との相性
5. 将来的な拡張性

## 検討した選択肢

### 1. REST API (Route Handlers)

**概要**: Next.js標準のRoute Handlersを使用

```typescript
// app/api/items/route.ts
export async function GET(request: Request) {
  const result = await db.select().from(items)
  return Response.json(result)
}
```

**メリット**:
- 学習コスト: ゼロ（標準機能）
- シンプル
- 外部クライアントからも呼び出し可能

**デメリット**:
- 型安全性がない（手動で型定義が必要）
- バリデーションを別途実装
- ボイラープレートが多い

### 2. GraphQL (Apollo)

**概要**: Apollo ServerとApollo Clientを使用

```typescript
// schema定義
type Query {
  items(groupId: ID): [Item!]!
}

// resolver
const resolvers = {
  Query: {
    items: (_, { groupId }) => db.select().from(items).where(eq(items.groupId, groupId))
  }
}
```

**メリット**:
- 柔軟なクエリ
- 型生成 (GraphQL Codegen)
- キャッシュ機能

**デメリット**:
- 学習コスト: 高
- オーバーヘッド（買い物メモアプリには過剰）
- Apollo Clientのバンドルサイズ

### 3. tRPC + Server Actions

**概要**: tRPCでAPIを定義し、必要に応じてServer Actionsを併用

```typescript
// router定義
export const itemRouter = router({
  getAll: publicProcedure
    .input(z.object({ groupId: z.string().optional() }))
    .query(({ input }) => {
      return db.select().from(items).where(eq(items.groupId, input.groupId))
    }),
  create: protectedProcedure
    .input(createItemSchema)
    .mutation(({ input }) => {
      return itemService.create(input)
    }),
})

// クライアント
const { data } = trpc.item.getAll.useQuery({ groupId: 'xxx' })
```

**メリット**:
- TypeScriptネイティブ（スキーマからクライアントまで型安全）
- Zodとの統合（バリデーション自動化）
- Next.js App Routerとの親和性
- 軽量（GraphQLより小さいバンドル）
- 学習コスト: 中（TypeScriptベース）

**デメリット**:
- 外部クライアントからの呼び出しにはアダプタが必要
- Next.js以外への移植性

## 決定

**tRPC + Server Actions を採用する**

### 使い分け

| 用途 | 技術 |
|------|------|
| データ取得（Query） | tRPC |
| データ更新（Mutation） | tRPC |
| フォーム送信 | Server Actions（Progressive Enhancement） |
| 同期操作 | tRPC |

### 実装パターン

```typescript
// src/infrastructure/trpc/routers/catalog.ts
import { router, publicProcedure, protectedProcedure } from '../server'
import { createItemSchema, updateItemSchema } from '@/shared/schemas/item'
import { CreateItemHandler } from '@/modules/catalog/application/commands/CreateItem'

export const catalogRouter = router({
  // Query
  items: publicProcedure
    .input(z.object({
      groupId: z.string().optional(),
      tagIds: z.array(z.string()).optional(),
    }))
    .query(async ({ input }) => {
      return new GetItemsHandler(db).execute(input)
    }),

  // Command
  createItem: protectedProcedure
    .input(createItemSchema)
    .mutation(async ({ input, ctx }) => {
      return new CreateItemHandler(itemRepository).execute({
        ...input,
        userId: ctx.userId,
      })
    }),
})
```

## 理由

### 1. 型安全性

tRPCはTypeScriptの型推論を最大限に活用する。

```typescript
// サーバー側で定義
const router = t.router({
  getItem: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      return db.select().from(items).where(eq(items.id, input.id))
    }),
})

// クライアント側で自動的に型推論
const { data } = trpc.getItem.useQuery({ id: '123' })
// data の型は Item | null と推論される
```

### 2. Zodとの統合

バリデーションとTypeScriptの型が一致する。

```typescript
// src/shared/schemas/item.ts
export const createItemSchema = z.object({
  name: z.string().min(1).max(100),
  quantity: z.number().int().positive().default(1),
  memo: z.string().max(500).optional(),
  tagIds: z.array(z.string()).default([]),
  groupId: z.string().optional(),
})

export type CreateItemInput = z.infer<typeof createItemSchema>
```

### 3. Next.js App Routerとの親和性

```typescript
// app/api/trpc/[trpc]/route.ts
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@/infrastructure/trpc/routers'

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => ({}),
  })

export { handler as GET, handler as POST }
```

### 4. 軽量性

| ライブラリ | バンドルサイズ (gzip) |
|-----------|---------------------|
| @trpc/client | ~8KB |
| @apollo/client | ~40KB |
| urql | ~15KB |

### 5. 学習コスト

- TypeScriptの知識があれば習得が容易
- GraphQLのような独自クエリ言語を学ぶ必要がない
- Zodは他のプロジェクトでも汎用的に使える

## 影響

### ポジティブ
- フロントエンドとバックエンドの型が自動的に同期
- バリデーションエラーがコンパイル時に検出される
- 開発速度の向上

### ネガティブ
- 外部クライアント（モバイルアプリなど）からの呼び出しには工夫が必要
- tRPCのバージョンアップへの追従が必要

### 対策
- 外部クライアントが必要になった場合、OpenAPI変換を検討
- バージョン固定と定期的なアップデート

## 参考資料

- [tRPC公式ドキュメント](https://trpc.io/)
- [tRPC + Next.js App Router](https://trpc.io/docs/client/nextjs/app-router)
- [Zod公式ドキュメント](https://zod.dev/)
