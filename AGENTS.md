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

<!-- NEXT-AGENTS-MD-START -->[Next.js Docs Index]|root: ./.next-docs|STOP. What you remember about Next.js is WRONG for this project. Always search docs and read before any task.|If docs missing, run this command first: npx @next/codemod agents-md --output AGENTS.md|01-app:{glossary.mdx}|01-app/01-getting-started:{01-installation.mdx,02-project-structure.mdx,03-layouts-and-pages.mdx,04-linking-and-navigating.mdx,05-server-and-client-components.mdx,06-cache-components.mdx,07-fetching-data.mdx,08-updating-data.mdx,09-caching-and-revalidating.mdx,10-error-handling.mdx,11-css.mdx,12-images.mdx,13-fonts.mdx,14-metadata-and-og-images.mdx,15-route-handlers.mdx,16-proxy.mdx,17-deploying.mdx,18-upgrading.mdx}|01-app/02-guides:{analytics.mdx,authentication.mdx,backend-for-frontend.mdx,caching.mdx,ci-build-caching.mdx,content-security-policy.mdx,css-in-js.mdx,custom-server.mdx,data-security.mdx,debugging.mdx,draft-mode.mdx,environment-variables.mdx,forms.mdx,incremental-static-regeneration.mdx,instrumentation.mdx,internationalization.mdx,json-ld.mdx,lazy-loading.mdx,local-development.mdx,mcp.mdx,mdx.mdx,memory-usage.mdx,multi-tenant.mdx,multi-zones.mdx,open-telemetry.mdx,package-bundling.mdx,prefetching.mdx,production-checklist.mdx,progressive-web-apps.mdx,redirecting.mdx,sass.mdx,scripts.mdx,self-hosting.mdx,single-page-applications.mdx,static-exports.mdx,tailwind-v3-css.mdx,third-party-libraries.mdx,videos.mdx}|01-app/02-guides/migrating:{app-router-migration.mdx,from-create-react-app.mdx,from-vite.mdx}|01-app/02-guides/testing:{cypress.mdx,jest.mdx,playwright.mdx,vitest.mdx}|01-app/02-guides/upgrading:{codemods.mdx,version-14.mdx,version-15.mdx,version-16.mdx}|01-app/03-api-reference:{07-edge.mdx,08-turbopack.mdx}|01-app/03-api-reference/01-directives:{use-cache-private.mdx,use-cache-remote.mdx,use-cache.mdx,use-client.mdx,use-server.mdx}|01-app/03-api-reference/02-components:{font.mdx,form.mdx,image.mdx,link.mdx,script.mdx}|01-app/03-api-reference/03-file-conventions/01-metadata:{app-icons.mdx,manifest.mdx,opengraph-image.mdx,robots.mdx,sitemap.mdx}|01-app/03-api-reference/03-file-conventions:{default.mdx,dynamic-routes.mdx,error.mdx,forbidden.mdx,instrumentation-client.mdx,instrumentation.mdx,intercepting-routes.mdx,layout.mdx,loading.mdx,mdx-components.mdx,not-found.mdx,page.mdx,parallel-routes.mdx,proxy.mdx,public-folder.mdx,route-groups.mdx,route-segment-config.mdx,route.mdx,src-folder.mdx,template.mdx,unauthorized.mdx}|01-app/03-api-reference/04-functions:{after.mdx,cacheLife.mdx,cacheTag.mdx,connection.mdx,cookies.mdx,draft-mode.mdx,fetch.mdx,forbidden.mdx,generate-image-metadata.mdx,generate-metadata.mdx,generate-sitemaps.mdx,generate-static-params.mdx,generate-viewport.mdx,headers.mdx,image-response.mdx,next-request.mdx,next-response.mdx,not-found.mdx,permanentRedirect.mdx,redirect.mdx,refresh.mdx,revalidatePath.mdx,revalidateTag.mdx,unauthorized.mdx,unstable_cache.mdx,unstable_noStore.mdx,unstable_rethrow.mdx,updateTag.mdx,use-link-status.mdx,use-params.mdx,use-pathname.mdx,use-report-web-vitals.mdx,use-router.mdx,use-search-params.mdx,use-selected-layout-segment.mdx,use-selected-layout-segments.mdx,userAgent.mdx}|01-app/03-api-reference/05-config/01-next-config-js:{adapterPath.mdx,allowedDevOrigins.mdx,appDir.mdx,assetPrefix.mdx,authInterrupts.mdx,basePath.mdx,browserDebugInfoInTerminal.mdx,cacheComponents.mdx,cacheHandlers.mdx,cacheLife.mdx,compress.mdx,crossOrigin.mdx,cssChunking.mdx,devIndicators.mdx,distDir.mdx,env.mdx,expireTime.mdx,exportPathMap.mdx,generateBuildId.mdx,generateEtags.mdx,headers.mdx,htmlLimitedBots.mdx,httpAgentOptions.mdx,images.mdx,incrementalCacheHandlerPath.mdx,inlineCss.mdx,isolatedDevBuild.mdx,logging.mdx,mdxRs.mdx,onDemandEntries.mdx,optimizePackageImports.mdx,output.mdx,pageExtensions.mdx,poweredByHeader.mdx,productionBrowserSourceMaps.mdx,proxyClientMaxBodySize.mdx,reactCompiler.mdx,reactMaxHeadersLength.mdx,reactStrictMode.mdx,redirects.mdx,rewrites.mdx,sassOptions.mdx,serverActions.mdx,serverComponentsHmrCache.mdx,serverExternalPackages.mdx,staleTimes.mdx,staticGeneration.mdx,taint.mdx,trailingSlash.mdx,transpilePackages.mdx,turbopack.mdx,turbopackFileSystemCache.mdx,typedRoutes.mdx,typescript.mdx,urlImports.mdx,useLightningcss.mdx,viewTransition.mdx,webVitalsAttribution.mdx,webpack.mdx}|01-app/03-api-reference/05-config:{02-typescript.mdx,03-eslint.mdx}|01-app/03-api-reference/06-cli:{create-next-app.mdx,next.mdx}|02-pages/01-getting-started:{01-installation.mdx,02-project-structure.mdx,04-images.mdx,05-fonts.mdx,06-css.mdx,11-deploying.mdx}|02-pages/02-guides:{analytics.mdx,authentication.mdx,babel.mdx,ci-build-caching.mdx,content-security-policy.mdx,css-in-js.mdx,custom-server.mdx,debugging.mdx,draft-mode.mdx,environment-variables.mdx,forms.mdx,incremental-static-regeneration.mdx,instrumentation.mdx,internationalization.mdx,lazy-loading.mdx,mdx.mdx,multi-zones.mdx,open-telemetry.mdx,package-bundling.mdx,post-css.mdx,preview-mode.mdx,production-checklist.mdx,redirecting.mdx,sass.mdx,scripts.mdx,self-hosting.mdx,static-exports.mdx,tailwind-v3-css.mdx,third-party-libraries.mdx}|02-pages/02-guides/migrating:{app-router-migration.mdx,from-create-react-app.mdx,from-vite.mdx}|02-pages/02-guides/testing:{cypress.mdx,jest.mdx,playwright.mdx,vitest.mdx}|02-pages/02-guides/upgrading:{codemods.mdx,version-10.mdx,version-11.mdx,version-12.mdx,version-13.mdx,version-14.mdx,version-9.mdx}|02-pages/03-building-your-application/01-routing:{01-pages-and-layouts.mdx,02-dynamic-routes.mdx,03-linking-and-navigating.mdx,05-custom-app.mdx,06-custom-document.mdx,07-api-routes.mdx,08-custom-error.mdx}|02-pages/03-building-your-application/02-rendering:{01-server-side-rendering.mdx,02-static-site-generation.mdx,04-automatic-static-optimization.mdx,05-client-side-rendering.mdx}|02-pages/03-building-your-application/03-data-fetching:{01-get-static-props.mdx,02-get-static-paths.mdx,03-forms-and-mutations.mdx,03-get-server-side-props.mdx,05-client-side.mdx}|02-pages/03-building-your-application/06-configuring:{12-error-handling.mdx}|02-pages/04-api-reference:{06-edge.mdx,08-turbopack.mdx}|02-pages/04-api-reference/01-components:{font.mdx,form.mdx,head.mdx,image-legacy.mdx,image.mdx,link.mdx,script.mdx}|02-pages/04-api-reference/02-file-conventions:{instrumentation.mdx,proxy.mdx,public-folder.mdx,src-folder.mdx}|02-pages/04-api-reference/03-functions:{get-initial-props.mdx,get-server-side-props.mdx,get-static-paths.mdx,get-static-props.mdx,next-request.mdx,next-response.mdx,use-params.mdx,use-report-web-vitals.mdx,use-router.mdx,use-search-params.mdx,userAgent.mdx}|02-pages/04-api-reference/04-config/01-next-config-js:{adapterPath.mdx,allowedDevOrigins.mdx,assetPrefix.mdx,basePath.mdx,bundlePagesRouterDependencies.mdx,compress.mdx,crossOrigin.mdx,devIndicators.mdx,distDir.mdx,env.mdx,exportPathMap.mdx,generateBuildId.mdx,generateEtags.mdx,headers.mdx,httpAgentOptions.mdx,images.mdx,isolatedDevBuild.mdx,onDemandEntries.mdx,optimizePackageImports.mdx,output.mdx,pageExtensions.mdx,poweredByHeader.mdx,productionBrowserSourceMaps.mdx,proxyClientMaxBodySize.mdx,reactStrictMode.mdx,redirects.mdx,rewrites.mdx,serverExternalPackages.mdx,trailingSlash.mdx,transpilePackages.mdx,turbopack.mdx,typescript.mdx,urlImports.mdx,useLightningcss.mdx,webVitalsAttribution.mdx,webpack.mdx}|02-pages/04-api-reference/04-config:{01-typescript.mdx,02-eslint.mdx}|02-pages/04-api-reference/05-cli:{create-next-app.mdx,next.mdx}|03-architecture:{accessibility.mdx,fast-refresh.mdx,nextjs-compiler.mdx,supported-browsers.mdx}|04-community:{01-contribution-guide.mdx,02-rspack.mdx}<!-- NEXT-AGENTS-MD-END -->
