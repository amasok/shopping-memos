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
- **PWA**: `src/app/manifest.ts` + Serwist の Service Worker（`src/app/sw.ts`。アプリシェルのプリキャッシュ、`/api/**` はキャッシュしない。kill switch あり）
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
npm run db:push               # スキーマを直接反映（ローカル DB 専用。develop・本番の DB には使わない。記録が残らず migrate が失敗する）
npm run db:studio             # Drizzle Studio
npm run db:reset              # ローカル DB の public スキーマを作り直して db:push
# migration は _journal.json の when の順に当たる。ブランチ間で migration が衝突したら、
# 手で解消せず develop を取り込んでから db:generate で作り直す（古い when が残ると本番で飛ばされる。#122）

# テスト
npm test                      # Vitest（watch）
npm run test:run              # Vitest 1回実行
npm run test:coverage         # カバレッジ付き
npm run test:e2e              # Playwright（E2E_BUILD=true E2E_TEST=true で dev サーバーを自動起動。E2E_SEED_TOKEN は自動生成）
npm run test:e2e:ui           # Playwright UI モード
npm run test:e2e:local        # CI と同じ E2E（chromium・chromium-auth・Mobile Chrome・offline）を全部ローカルで流す。Docker の postgres に worktree ごとの DB、空いているポート（#142）
# ポートは E2E_PORT / E2E_OFFLINE_PORT（既定 3000 / 3100）。別の worktree のサーバーに当たらないよう、並行するときは変える
# 自分で起動したサーバーを使い回す場合は、サーバーを E2E_BUILD=true E2E_TEST=true E2E_SEED_TOKEN=<32文字以上> で起動し、テストにも同じ E2E_SEED_TOKEN を渡す

# Docker
docker compose down           # 停止
```

### Push 前の必須チェック

```bash
npm run lint && npm run test:run && npm run build
```

CI（`.github/workflows/ci.yml`）は、PR と main への push で lint・typecheck・unit test・coverage・build を実行する。develop への push では develop 用 DB の migrate だけを行う。E2E は main への PR と main への push だけ（develop への PR の前に `npm run test:e2e:local` で全部流す）、本番 DB の migrate は main への push だけ。docs だけの変更でも動く（ブランチ保護の必須チェックを付けるため）。

### CI が使う DB の接続先（GitHub Actions の secret）

| secret | 中身 | 使う job |
|--------|------|----------|
| `NEON_DATABASE_URL` | 本番の DB（Neon の本番ブランチ） | `migrate`（main への push） |
| `DEVELOP_DATABASE_URL` | Neon の console で develop ブランチを選び、Connect から取った接続文字列（pooling オフ） | `migrate-develop`（develop への push） |

- Preview（develop のデプロイ）は、Neon の develop ブランチにつながっている（実測。develop ブランチに migrate すると Preview のエラーが消えた）
- Vercel の画面の `DATABASE_URL` は Production と Preview で共通の 1 つで、値は本番なので、`DEVELOP_DATABASE_URL` には使わない（コピーすると、develop の migration が本番に当たる）
- Preview が develop ブランチにつながる仕組みは未確認。Neon の Vercel 連携が、git ブランチ develop 向けの値を別に入れていると推測している
- `migrate-develop` は、`DEVELOP_DATABASE_URL` が本番と同じ DB（host と DB 名）を指していたら止まる（#139）

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
│       └── e2e/seed/            # E2E 用シード（route.e2e.ts。E2E_BUILD のビルドだけに含まれ、E2E_TEST・VERCEL_ENV・x-e2e-token で守る）
├── modules/                # 境界づけられたコンテキスト（ADR 002）。DDD の層構成
│   ├── catalog/            # アイテム・タグ
│   ├── identity/           # グループ・メンバー・招待リンク
│   ├── shopping/           # 買い物リスト・リストアイテム
│   └── sync/               # 同期操作
│       # 主な層（モジュールによって一部ない）: domain/{entities,value-objects,repositories,services} /
│       #   application/{commands,queries,services} / infrastructure/repositories（Drizzle 実装）
│       # commands/ queries/ は現在空（.gitkeep のみ）。tRPC routers が Drizzle・repositories・services を直接使う
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
docs/design-doc.md          # 全体の設計書（構成・コンテキスト・同期・現状の課題と目指す構造）
docs/adr/                   # ADR 001〜005（実装とのずれは design-doc.md に記載）
docs/features/              # 以前の機能設計書（参照用。新しくは作らない）
openspec/                   # OpenSpec。specs/ は今の振る舞いの正、changes/ は進行中の変更（feature-design.md）
.agents/skills/openspec-*   # OpenSpec のスキル（.claude/skills/openspec-* はそこへのリンク）
```

パスエイリアス: `@/*` → `src/*`

### データの流れ（サーバーファースト＋ゲストはローカル）

- `useDataSource()` が `useServer` / `useLocal` を返す。
  - 未ログイン: Dexie（IndexedDB）を読み書きする。
  - ログイン中かつマージ完了: tRPC 経由でサーバー（PostgreSQL）を使う。
  - ログイン直後: `DataMergeContext` がローカルのデータをサーバーへマージし、完了までは Dexie を使う。ログインのたびにゲストのデータがあれば送り、全部取り込めたら Dexie を空にする。ログアウトすると空のゲストに戻る（docs/features/offline-support.md「4b」）。
- `src/hooks/data/*` のフックはこの判定で Dexie と tRPC を切り替えるので、ページ・コンポーネントはフック経由でデータにアクセスする。
- グループ選択は `GroupContext`（`selectedGroupId`）。tRPC 側は `middleware/groupAuth.ts` でメンバーシップを検証する。
- ログイン中でマージが終わると `SyncProvider` が `SyncEngine` を動かす（#62 O6）。`NEXT_PUBLIC_LOCAL_FIRST=true` のときだけ push と pull を行うが、画面の読み書きはまだ tRPC のまま（hooks をローカルのリポジトリ経由にするのは O7・O8）。詳しくは `docs/design-doc.md`。

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
- **振る舞いを変える実装の前に OpenSpec の change（proposal・specs）を作り、ユーザーの承認を得てから実装**する。Issue は何を・なぜ・優先度、change は振る舞いの仕様・設計・手順（`feature-design.md`）
- **プロダクトコードの変更にはテストを付ける**。カバレッジ 80% 以上（`testing.md`）
- ブランチは develop から `feature/` `fix/` `refactor/` `docs/` を切り、develop 向けに PR を作る。コミットは Conventional Commits（`git-workflow.md`）
- E2E テストは IndexedDB を `page.evaluate()` で直接操作する。主要コンポーネントには `data-testid` を付ける

## Next.js ドキュメント

Next.js 16 の API は記憶に頼らず、`./.next-docs/`（gitignore 対象）を grep して確認すること。
無ければ `npx @next/codemod agents-md` で再生成する。その際 AGENTS.md に索引ブロック（約7KB）が再挿入された場合は削除して、この節だけを残す。
