# AGENTS.md

AI コーディングエージェント向けのプロジェクトガイド。`CLAUDE.md`（`!include AGENTS.md`）と `GEMINI.md`（`@AGENTS.md`）から読み込まれる。

## プロジェクト概要

家族と共有できるお買い物メモ帳アプリ。Next.js 製の PWA として、スマホのホーム画面に追加して使う。

### 主な機能
- アイテム（買いたいもの）とタグの管理、タグでの絞り込み
- 買い物リストの作成・チェック・完了、購入履歴
- グループ（家族）作成・招待リンクによるメンバー追加・グループ内でのデータ共有
- URL の OGP プレビュー（`/api/ogp`）
- ゲストモード: ログインなしで全機能を端末内（IndexedDB）だけで利用でき、ログイン時にサーバーへマージ

## 技術スタック

- **フレームワーク**: Next.js 16 (App Router) / React 19 / TypeScript
- **API**: tRPC v11 + TanStack Query v5（superjson）
- **認証**: NextAuth.js v5 (Auth.js) + `@auth/drizzle-adapter`（Google プロバイダ。E2E 時のみ Credentials）
- **サーバー DB**: Drizzle ORM + drizzle-kit / PostgreSQL 16（ローカルは Docker、本番は Neon）
- **ローカル DB**: Dexie (IndexedDB) + dexie-react-hooks
- **バリデーション**: Zod v4
- **スタイリング**: Tailwind CSS v4、lucide-react
- **PWA**: `src/app/manifest.ts` + 最小の `public/sw.js`（キャッシュなし、インストール要件のみ）。Service Worker ライブラリは未導入（ADR 005 で Serwist 採用を提案中）
- **テスト**: Vitest + Testing Library（jsdom）/ Playwright
- **ランタイム**: Node.js 22.22.0（`.tool-versions`、asdf）※ CI は Node 20
- **ホスティング**: Vercel

## 開発コマンド

```bash
# 初回セットアップ
docker compose up -d          # PostgreSQL（:5432）と Adminer（:8080）を起動
npm install
cp .env.example .env          # 環境変数を設定
npm run db:migrate            # マイグレーション適用

# 開発
npm run dev                   # 開発サーバー (http://localhost:3000)
npm run build                 # プロダクションビルド
npm run start                 # プロダクションサーバー
npm run lint                  # ESLint

# DB（Drizzle）
npm run db:generate           # schema.ts からマイグレーション SQL を生成
npm run db:migrate            # マイグレーション適用
npm run db:push               # スキーマを直接反映（開発用）
npm run db:studio             # Drizzle Studio
npm run db:reset              # ローカル DB の public スキーマを作り直して db:push

# テスト
npm test                      # Vitest（watch）
npm run test:run              # Vitest 1回実行
npm run test:coverage         # カバレッジ付き
npm run test:e2e              # Playwright（E2E_TEST=true で dev サーバーを自動起動）
npm run test:e2e:ui           # Playwright UI モード

# Docker
docker compose down           # 停止
```

### Push 前の必須チェック

```bash
npm run lint && npm run test:run && npm run build
```

CI（`.github/workflows/ci.yml`）は main / develop への push と PR で lint・unit test・coverage・build を実行する。main では本番 DB マイグレーションと E2E も実行される。

## アーキテクチャ

```
src/
├── app/                    # Next.js App Router（ページはクライアントコンポーネント中心）
│   ├── page.tsx            # ホーム（アイテム一覧）
│   ├── items/new, lists/, lists/new, lists/[id], history/, tags/,
│   │   groups/, groups/[id], settings/, login/, privacy/, terms/
│   ├── manifest.ts         # Web App Manifest
│   ├── providers.tsx       # Theme → TRPC → Auth → DataMerge → Group → DB の Provider 構成
│   └── api/
│       ├── auth/[...nextauth]/  # NextAuth
│       ├── trpc/[trpc]/         # tRPC エンドポイント
│       ├── ogp/                 # OGP 取得
│       └── e2e/seed/            # E2E 用シード（E2E_TEST=true のときのみ有効）
├── modules/                # 境界づけられたコンテキスト（ADR 002）。DDD の層構成
│   ├── catalog/            # アイテム・タグ
│   ├── identity/           # グループ・メンバー・招待リンク
│   ├── shopping/           # 買い物リスト・リストアイテム
│   └── sync/               # 同期操作
│       # 各モジュール: domain/{entities,value-objects,repositories} /
│       #   application/{commands,queries,services} / infrastructure/repositories（Drizzle 実装）
├── infrastructure/
│   ├── auth/               # NextAuth 設定（auth, signIn, signOut, handlers）
│   ├── db/drizzle/         # client.ts, schema.ts, migrations/
│   ├── trpc/               # server.ts（publicProcedure / protectedProcedure）, client.ts, provider.tsx,
│   │                       # routers/{identity,catalog,shopping,sync}.ts, middleware/groupAuth.ts
│   └── sync/SyncEngine.ts  # クライアント側同期エンジン（syncQueue を処理）
├── lib/
│   ├── db/                 # Dexie（ShoppingMemosDB）定義・CRUD・DBProvider（初期タグ投入）
│   ├── url.ts, utils.ts
├── hooks/
│   ├── data/               # useItems, useLists, useTags, useGroups, useHistory と各 Mutation フック
│   │                       # useDataSource でゲスト=Dexie / ログイン=tRPC を切り替える
│   └── useInstallPrompt.ts
├── contexts/               # AuthContext, GroupContext, DataMergeContext, SyncContext, ThemeContext
├── components/
│   ├── ui/                 # 汎用 UI（Button, Input, BottomSheet など）
│   ├── layouts/
│   ├── features/{auth,groups,items,sync,tags}/
│   └── pwa/                # InstallPrompt, RegisterSW
├── shared/
│   ├── schemas/            # Zod スキーマ（item, tag, list, group, history, sync, common）。tRPC 入力と共有
│   └── types/
├── test/setup.ts           # Vitest セットアップ
└── types/next-auth.d.ts

e2e/                        # Playwright（fixtures/, auth/ はログイン必須のグループ系テスト）
docs/adr/                   # ADR 001〜005
docs/features/              # 機能設計書（.claude/rules/feature-design.md に従って作成）
```

パスエイリアス: `@/*` → `src/*`

### データの流れ（サーバーファースト＋ゲストはローカル）

- `useDataSource()` が `useServer` / `useLocal` を返す。
  - 未ログイン: Dexie（IndexedDB）を読み書きする。
  - ログイン中かつマージ完了: tRPC 経由でサーバー（PostgreSQL）を使う。
  - ログイン直後: `DataMergeContext` がローカルのデータをサーバーへマージし、完了までは Dexie を使う。
- `src/hooks/data/*` のフックはこの判定で Dexie と tRPC を切り替えるので、ページ・コンポーネントはフック経由でデータにアクセスする。
- グループ選択は `GroupContext`（`selectedGroupId`）。tRPC 側は `middleware/groupAuth.ts` でメンバーシップを検証する。
- Dexie には `syncQueue` テーブルと `SyncEngine` / `SyncContext` があるが、現時点で Provider には組み込まれていない（#62 で対応中）。

### データモデル

サーバー（`src/infrastructure/db/drizzle/schema.ts`）:

- **users / accounts / sessions / verificationTokens**: Auth.js 用
- **groups / groupMembers / inviteLinks**: グループ、メンバー、招待リンク
- **items / tags / itemTags**: アイテム、タグ、その多対多
- **shoppingLists / listItems**: 買い物リストとリスト内アイテム
- **syncOperations**: 同期操作の記録

ローカル（`src/lib/db/index.ts`、Dexie `ShoppingMemosDB`）:

- `tags`, `items`, `lists`, `listItems`, `groups`, `groupMembers`, `syncQueue`
- スキーマ変更時は `this.version(n).stores(...)` を追加する（既存バージョンは書き換えない）。購入履歴は `lists.purchasedAt` が入ったリストとして扱う（旧 `history` テーブルは廃止）。

## 進行中の変更

未実装の内容を現状として扱わないこと。

- 認証: Google OAuth からパスキー＋メールアドレス認証へ変更予定（#61）
- オフライン対応: ログイン中のオフライン編集と復帰時同期、Service Worker キャッシュ（#62、ADR 004 / 005）

## 開発ルール

詳細は `.claude/rules/` を参照。

- **タスク管理は GitHub Issues**（`gh issue ...`）。Claude Code の Task ツールやマークダウンでの管理はしない（`task-management.md`）
- **機能実装前に設計書を作成し、承認を得てから実装**する。置き場所は `docs/features/<機能名>.md`（`feature-design.md`）
- **プロダクトコードの変更にはテストを付ける**。カバレッジ 80% 以上（`testing.md`）
- ブランチは develop から `feature/` `fix/` `refactor/` `docs/` を切り、develop 向けに PR を作る。コミットは Conventional Commits（`git-workflow.md`）
- E2E テストは IndexedDB を `page.evaluate()` で直接操作する。主要コンポーネントには `data-testid` を付ける

## Next.js ドキュメント

Next.js 16 の API は記憶に頼らず、`./.next-docs/`（gitignore 対象）を grep して確認すること。
無ければ `npx @next/codemod agents-md` で再生成する。その際 AGENTS.md に索引ブロック（約7KB）が再挿入された場合は削除して、この節だけを残す。
