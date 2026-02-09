# インフラストラクチャ設計書

## 1. 概要

本ドキュメントは買い物メモアプリのインフラストラクチャ設計を定義する。

### 1.1 設計方針

| 方針 | 説明 |
|------|------|
| **無料枠優先** | Hobby/Free tierで運用可能な構成 |
| **シンプルさ** | 個人開発に適したシンプルな構成 |
| **UI管理** | 各サービスのダッシュボードで管理 |
| **セキュリティ** | 認証情報は環境変数で管理、リポジトリにコミットしない |

### 1.2 アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────┐
│                        GitHub                               │
│  ┌─────────────┐                                           │
│  │ Repository  │──push──→ Vercel (自動デプロイ)            │
│  │             │                                           │
│  │ - App Code  │         ┌─────────────────────────┐       │
│  └─────────────┘         │ Production (main)       │       │
│                          │ Preview (develop/PR)    │       │
│                          └───────────┬─────────────┘       │
└──────────────────────────────────────┼─────────────────────┘
                                       │
                          ┌────────────┴────────────┐
                          │                         │
                    ┌─────▼─────┐           ┌──────▼──────┐
                    │   Neon    │           │ Google OAuth│
                    │ (Postgres)│           │ (認証)      │
                    └───────────┘           └─────────────┘
```

### 1.3 Neon を選択した理由

| 比較項目 | Neon | Supabase |
|---------|------|----------|
| PostgreSQL | ✅ | ✅ |
| 認証機能 | ❌ (不要、NextAuth使用) | ✅ (過剰) |
| リアルタイム | ❌ (不要) | ✅ (過剰) |
| ストレージ | ❌ (不要) | ✅ (過剰) |
| ブランチング | ✅ 対応 | ❌ |
| Vercel統合 | ✅ | △ |

**結論**: このアプリはPostgreSQLのみ必要。Supabaseは機能過多。

---

## 2. サービス構成

### 2.1 Vercel (ホスティング)

| 項目 | 値 |
|------|-----|
| プラン | **Hobby (無料)** |
| プロジェクト数 | 1 |
| 帯域幅 | 100GB/月 |
| Serverless Functions | 100GB-Hours/月 |
| ビルド時間 | 100時間/月 |

**管理方法:** Vercel ダッシュボード

### 2.2 Neon (PostgreSQL)

| 項目 | 値 |
|------|-----|
| プラン | **Neon Free Plan** |
| ストレージ | 512MB（全ブランチ合計） |
| コンピュート | 100CU時間/月 |
| ブランチ | **10個まで** |
| 履歴保持 | 6時間 |

**ブランチ構成（重要）:**

```
Neon Project (1つ)
├── production  ← Production環境用（デフォルト）
└── develop     ← Preview環境用（手動作成）
```

| 環境 | Neonブランチ | 用途 |
|------|-------------|------|
| Production | `production` | 本番データ |
| Preview | `develop` | 開発・テストデータ |

> ⚠️ **PRごとの自動ブランチ作成は無効にする**
> Vercel + Neon統合でPRごとにブランチを自動作成すると、10個の上限にすぐ達する。
> 本プロジェクトでは `production` と `develop` の2ブランチのみ使用し、無料枠内で運用する。

**管理方法:** Neon ダッシュボード (https://console.neon.tech)

**参考:**
- [Neon Branching](https://neon.com/docs/introduction/branching)
- [Neon Free Tier](https://neon.com/docs/introduction/plans)

### 2.3 Google Cloud (OAuth認証)

| 項目 | 値 |
|------|-----|
| プラン | **無料** |
| 用途 | OAuth 2.0 認証のみ |

**管理方法:** Google Cloud Console (https://console.cloud.google.com)

---

## 3. 環境構成

### 3.1 環境一覧

| 環境 | ブランチ | URL | 用途 |
|------|---------|-----|------|
| Production | main | shopping-memos.vercel.app | 本番環境 |
| Preview | develop | (自動生成) | 開発検証 |
| PR Preview | feature/* | (自動生成) | PR単位の検証 |

### 3.2 環境変数

| 変数名 | 説明 | 環境 | 管理方法 |
|--------|------|------|----------|
| `POSTGRES_URL` | DB接続文字列 (pooled) | 全環境 | Neon連携で自動設定 |
| `POSTGRES_URL_NON_POOLING` | 直接接続 (マイグレーション用) | 全環境 | Neon連携で自動設定 |
| `DATABASE_URL` | アプリ用DB接続文字列 | 全環境 | Vercelダッシュボード |
| `NEXTAUTH_URL` | 認証コールバックURL | 環境別 | Vercelダッシュボード |
| `NEXTAUTH_SECRET` | セッション暗号化キー | 全環境 | Vercelダッシュボード |
| `GOOGLE_CLIENT_ID` | OAuth クライアントID | 全環境 | Vercelダッシュボード |
| `GOOGLE_CLIENT_SECRET` | OAuth シークレット | 全環境 | Vercelダッシュボード |

**設定場所:** Vercel Dashboard > Project > Settings > Environment Variables

---

## 4. セットアップ手順

### Phase 1: Vercel準備

1. **Vercelアカウント作成**
   - https://vercel.com/signup
   - GitHub / Google / Email いずれかで登録

2. **GitHubリポジトリをインポート**
   - `amasok/shopping-memos` を選択
   - Framework: Next.js（自動検出）
   - 環境変数は後で設定するのでスキップ

### Phase 2: Neonデータベース設定

1. **Neonアカウント作成 & プロジェクト作成**
   - https://console.neon.tech
   - リージョン: `Asia Pacific (Singapore)` 推奨

2. **ブランチ作成**
   - デフォルトの `production` ブランチはそのまま
   - `develop` ブランチを手動作成
   - Neon Console > Branches > Create Branch

3. **VercelにNeonを接続**
   - Vercel Dashboard > Project > Storage > Connect Database
   - Neon を選択して接続
   - Production: `production` ブランチ
   - Preview: `develop` ブランチ

### Phase 3: 環境変数設定

Vercel Dashboard > Project > Settings > Environment Variables で設定：

| 変数名 | 値 | Target |
|--------|-----|--------|
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` で生成 | Production, Preview |
| `GOOGLE_CLIENT_ID` | Google Cloud Console から取得 | Production, Preview |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console から取得 | Production, Preview |
| `NEXTAUTH_URL` | `https://shopping-memos.vercel.app` | Production |

### Phase 4: Google OAuth設定

1. **Google Cloud Console確認**
   - https://console.cloud.google.com/apis/credentials

2. **リダイレクトURI追加**
   - 本番: `https://shopping-memos.vercel.app/api/auth/callback/google`
   - Preview: `https://*-shopping-memos.vercel.app/api/auth/callback/google`

### Phase 5: DBマイグレーション

```bash
npx drizzle-kit push
```

---

## 5. セキュリティ考慮事項

### 5.1 機密情報の管理

| 情報 | 保管場所 |
|------|---------|
| Google OAuth認証情報 | Vercelダッシュボード |
| NEXTAUTH_SECRET | Vercelダッシュボード |
| DATABASE_URL | Vercelダッシュボード（Neon連携で自動） |

**原則:** シークレットはGitにコミットしない。すべてVercelダッシュボードで管理。

---

## 6. コスト見積もり

| サービス | プラン | 月額コスト |
|---------|--------|-----------|
| Vercel | Hobby | **$0** |
| Neon | Free | **$0** |
| Google Cloud | OAuth only | **$0** |
| GitHub | Free | **$0** |
| **合計** | | **$0** |

### 6.1 無料枠の制限

| サービス | 制限 | 超過時の対応 |
|---------|------|-------------|
| Vercel | 100GB帯域/月 | Pro ($20/月) にアップグレード |
| Neon | 512MB, 100CU時間/月, 10ブランチ | Pro にアップグレード |

**想定ユーザー数:** 〜100人程度であれば無料枠で十分

---

## 7. 参考リンク

- [Vercel Documentation](https://vercel.com/docs)
- [Neon Documentation](https://neon.com/docs)
- [Vercel Pricing](https://vercel.com/pricing)
- [Neon Pricing](https://neon.com/pricing)

---

## 変更履歴

| 日付 | バージョン | 変更内容 |
|------|-----------|---------|
| 2025-01-30 | 1.0 | 初版作成 |
| 2025-01-30 | 2.0 | Terraform削除、UI管理に変更 |
