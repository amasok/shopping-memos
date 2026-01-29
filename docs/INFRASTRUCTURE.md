# インフラストラクチャ設計書

## 1. 概要

本ドキュメントは買い物メモアプリのインフラストラクチャ設計を定義する。

### 1.1 設計方針

| 方針 | 説明 |
|------|------|
| **無料枠優先** | Hobby/Free tierで運用可能な構成 |
| **IaC (Infrastructure as Code)** | Terraformで管理可能な部分は全てコード化 |
| **シンプルさ** | 個人開発に適したシンプルな構成 |
| **セキュリティ** | 認証情報は環境変数で管理、リポジトリにコミットしない |

### 1.2 アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────┐
│                        GitHub                               │
│  ┌─────────────┐                                           │
│  │ Repository  │──push──→ Vercel (自動デプロイ)            │
│  │             │                                           │
│  │ - App Code  │         ┌─────────────────────────┐       │
│  │ - Terraform │         │ Production (main)       │       │
│  └─────────────┘         │ Preview (develop/PR)    │       │
│                          └───────────┬─────────────┘       │
└──────────────────────────────────────┼─────────────────────┘
                                       │
                          ┌────────────┴────────────┐
                          │                         │
                    ┌─────▼─────┐           ┌──────▼──────┐
                    │  Supabase │           │ Google OAuth│
                    │ (PostgreSQL)│         │ (認証)      │
                    └───────────┘           └─────────────┘
```

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

**Terraform管理可能な項目:**
- プロジェクト設定
- 環境変数
- ドメイン設定
- デプロイ設定

**参考:** [Vercel Terraform Provider](https://registry.terraform.io/providers/vercel/vercel/latest)

### 2.2 Supabase (データベース)

| 項目 | 値 |
|------|-----|
| プラン | **Free** |
| データベース | PostgreSQL 500MB |
| ストレージ | 1GB |
| 帯域幅 | 2GB/月 |
| Edge Functions | 500K invocations/月 |

**Terraform管理可能な項目:**
- プロジェクト設定
- データベース設定

**参考:** [Supabase Terraform Provider](https://supabase.com/docs/guides/platform/terraform)

### 2.3 Google Cloud (OAuth認証)

| 項目 | 値 |
|------|-----|
| プラン | **無料** |
| 用途 | OAuth 2.0 認証のみ |

**注意:** OAuth設定はGoogle Cloud Consoleでの手動設定が必要

---

## 3. 環境構成

### 3.1 環境一覧

| 環境 | ブランチ | URL | 用途 |
|------|---------|-----|------|
| Production | main | shopping-memos.vercel.app | 本番環境 |
| Preview | develop | develop.shopping-memos.vercel.app | 開発検証 |
| PR Preview | feature/* | (自動生成) | PR単位の検証 |

### 3.2 環境変数

| 変数名 | 説明 | 環境 | 管理方法 |
|--------|------|------|----------|
| `DATABASE_URL` | Supabase接続文字列 | 全環境 | Terraform |
| `DIRECT_URL` | Supabase直接接続 | 全環境 | Terraform |
| `NEXTAUTH_URL` | 認証コールバックURL | 環境別 | Terraform |
| `NEXTAUTH_SECRET` | セッション暗号化キー | 全環境 | Terraform (sensitive) |
| `GOOGLE_CLIENT_ID` | OAuth クライアントID | 全環境 | Terraform (sensitive) |
| `GOOGLE_CLIENT_SECRET` | OAuth シークレット | 全環境 | Terraform (sensitive) |

---

## 4. Terraform構成

### 4.1 ディレクトリ構成

```
terraform/
├── README.md              # セットアップ手順
├── .gitignore             # tfstate, .tfvars を除外
├── main.tf                # プロバイダー設定
├── variables.tf           # 変数定義
├── terraform.tfvars.example  # 変数サンプル（機密情報なし）
├── vercel.tf              # Vercelリソース
├── outputs.tf             # 出力定義
└── environments/
    ├── production.tfvars  # 本番用変数（.gitignore）
    └── preview.tfvars     # プレビュー用変数（.gitignore）
```

### 4.2 管理対象

| リソース | Terraform管理 | 理由 |
|---------|--------------|------|
| Vercelプロジェクト | ✅ | 自動化可能 |
| 環境変数 | ✅ | 自動化可能 |
| GitHub連携 | ❌ | 手動認証が必要 |
| Supabaseプロジェクト | ❌ | 既存プロジェクト使用 |
| Google OAuth | ❌ | 手動設定が必要 |
| カスタムドメイン | ✅ | 将来対応可能 |

---

## 5. タスク分解

### 5.1 人間が実施するタスク (手動)

これらのタスクはWebコンソールでの操作やアカウント認証が必要。

| # | タスク | 理由 | 所要時間 |
|---|--------|------|----------|
| H-1 | Vercelアカウント作成 | ブラウザ認証が必要 | 5分 |
| H-2 | Vercel APIトークン発行 | ダッシュボードで発行 | 2分 |
| H-3 | Vercel GitHub App インストール | OAuth認証が必要 | 3分 |
| H-4 | Google Cloud プロジェクト確認 | OAuth設定の確認 | 5分 |
| H-5 | Google OAuth リダイレクトURI追加 | 本番URLを追加 | 3分 |
| H-6 | terraform.tfvars 作成 | 機密情報の入力 | 5分 |
| H-7 | Terraform 初回実行 | ローカルで実行 | 5分 |

**合計所要時間: 約30分**

### 5.2 AIが実施するタスク (自動)

これらのタスクはClaudeが実装可能。

| # | タスク | 成果物 |
|---|--------|--------|
| A-1 | Terraformディレクトリ構成作成 | `terraform/` ディレクトリ |
| A-2 | Vercel Provider設定 | `main.tf` |
| A-3 | 変数定義ファイル作成 | `variables.tf` |
| A-4 | Vercelプロジェクト定義 | `vercel.tf` |
| A-5 | 出力定義 | `outputs.tf` |
| A-6 | .gitignore更新 | tfstate除外設定 |
| A-7 | tfvars サンプル作成 | `terraform.tfvars.example` |
| A-8 | セットアップ手順書作成 | `terraform/README.md` |

---

## 6. 実装手順

### Phase 1: 準備 (人間)

```
H-1: Vercelアカウント作成
     https://vercel.com/signup (GitHubアカウントで登録推奨)
         ↓
H-2: Vercel APIトークン発行
     Settings → Tokens → Create Token
     Scope: Full Access, Name: terraform
         ↓
H-3: Vercel GitHub App インストール
     https://github.com/apps/vercel
     リポジトリ: amasok/shopping-memos を選択
```

### Phase 2: Terraform実装 (AI)

```
A-1〜A-8: Terraformコード作成
         ↓
     コードレビュー & マージ
```

### Phase 3: デプロイ (人間)

```
H-6: terraform.tfvars 作成
     terraform.tfvars.example をコピーして値を設定
         ↓
H-7: Terraform実行
     cd terraform
     terraform init
     terraform plan
     terraform apply
         ↓
H-4, H-5: Google OAuth設定更新
     本番URLをリダイレクトURIに追加
```

---

## 7. セキュリティ考慮事項

### 7.1 機密情報の管理

| 情報 | 保管場所 | 備考 |
|------|---------|------|
| Vercel APIトークン | ローカル環境変数 | `VERCEL_API_TOKEN` |
| Google OAuth認証情報 | terraform.tfvars | .gitignore で除外 |
| NEXTAUTH_SECRET | terraform.tfvars | .gitignore で除外 |
| DATABASE_URL | terraform.tfvars | .gitignore で除外 |
| tfstate | ローカル | .gitignore で除外 |

### 7.2 .gitignore 設定

```gitignore
# Terraform
terraform/.terraform/
terraform/*.tfstate
terraform/*.tfstate.*
terraform/*.tfvars
!terraform/*.tfvars.example
terraform/.terraform.lock.hcl
```

### 7.3 将来の改善案 (Phase 2以降)

- **tfstate リモート管理**: Terraform Cloud (無料枠あり) でstate管理
- **シークレット管理**: HashiCorp Vault または AWS Secrets Manager
- **CI/CD統合**: GitHub Actions で terraform plan を自動実行

---

## 8. コスト見積もり

| サービス | プラン | 月額コスト |
|---------|--------|-----------|
| Vercel | Hobby | **$0** |
| Supabase | Free | **$0** |
| Google Cloud | OAuth only | **$0** |
| GitHub | Free | **$0** |
| **合計** | | **$0** |

### 8.1 無料枠の制限

| サービス | 制限 | 超過時の対応 |
|---------|------|-------------|
| Vercel | 100GB帯域/月 | Pro ($20/月) にアップグレード |
| Supabase | 500MB DB | Pro ($25/月) にアップグレード |

**想定ユーザー数:** 〜100人程度であれば無料枠で十分

---

## 9. 参考リンク

- [Vercel Terraform Guide](https://vercel.com/guides/integrating-terraform-with-vercel)
- [Vercel Provider - Terraform Registry](https://registry.terraform.io/providers/vercel/vercel/latest)
- [Supabase Terraform Provider](https://supabase.com/docs/guides/platform/terraform)
- [Vercel Pricing](https://vercel.com/pricing)
- [Supabase Pricing](https://supabase.com/pricing)

---

## 変更履歴

| 日付 | バージョン | 変更内容 |
|------|-----------|---------|
| 2025-01-30 | 1.0 | 初版作成 |
