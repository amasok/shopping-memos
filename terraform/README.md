# Terraform - Vercel Infrastructure

買い物メモアプリの Vercel インフラストラクチャを管理する Terraform 構成。

## 前提条件

### 1. Terraform CLI のインストール

```bash
# macOS (Homebrew)
brew install terraform

# または tfenv を使用
brew install tfenv
tfenv install latest
tfenv use latest
```

### 2. Vercel の準備 (手動)

以下の作業は Vercel ダッシュボードで手動実行が必要です：

1. **Vercel アカウント作成**
   - https://vercel.com/signup
   - GitHub アカウントで登録推奨

2. **API トークン発行**
   - https://vercel.com/account/tokens
   - Scope: `Full Access`
   - Name: `terraform`

3. **GitHub App インストール**
   - https://github.com/apps/vercel
   - リポジトリ `amasok/shopping-memos` を選択

4. **Neon データベース作成**
   - [Neon Console](https://console.neon.tech) でプロジェクト作成
   - リージョン: `Asia Pacific (Singapore)` または `Tokyo` 推奨
   - **ブランチ構成**:
     - `main` ブランチ: Production用
     - `develop` ブランチ: Preview用（手動で作成）
   - ⚠️ PRごとの自動ブランチ作成は**無効**にする（無料枠10個制限のため）

5. **Vercel に Neon を接続**
   - Vercel Dashboard > Project > Storage > Connect Database
   - Neon integration を選択して接続

## セットアップ手順

### 1. 環境変数の設定

```bash
export VERCEL_API_TOKEN="your-vercel-api-token"
```

### 2. 変数ファイルの作成

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars` を編集（プロジェクト名などの非機密情報のみ）

### 3. Terraform 初期化

```bash
terraform init
```

### 4. プランの確認

```bash
terraform plan
```

### 5. 適用

```bash
terraform apply
```

### 6. DB マイグレーション

Vercel Postgres 作成後、マイグレーションを実行：

```bash
# プロジェクトルートで実行
npx drizzle-kit push
```

## リソース一覧

| リソース | 説明 |
|---------|------|
| `vercel_project.app` | Vercel プロジェクト |
| `vercel_project_environment_variable.*` | 環境変数 |
| `vercel_project_git_configuration.main` | Git ブランチ設定 |

## 環境変数

### Terraform で管理（非機密情報のみ）

| 変数 | 説明 |
|------|------|
| `NEXTAUTH_URL` | 認証コールバック URL |
| `DATABASE_URL` | DB 接続文字列 (POSTGRES_URL のエイリアス) |

### Vercel ダッシュボードで設定（シークレット）

以下は **Vercel ダッシュボード** で直接設定してください：

| 変数 | 説明 | 生成方法 |
|------|------|----------|
| `NEXTAUTH_SECRET` | セッション暗号化キー | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | OAuth クライアント ID | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth シークレット | Google Cloud Console |

**設定場所**: Vercel Dashboard > Project > Settings > Environment Variables

**Target**: `Production` と `Preview` の両方にチェック

**理由**: Terraform の `tfstate` ファイルにシークレットが平文で保存されるリスクを回避

### Vercel Postgres が自動設定

| 変数 | 説明 |
|------|------|
| `POSTGRES_URL` | Pooled 接続文字列 |
| `POSTGRES_URL_NON_POOLING` | 直接接続 (マイグレーション用) |
| `POSTGRES_USER` | DB ユーザー |
| `POSTGRES_HOST` | DB ホスト |
| `POSTGRES_PASSWORD` | DB パスワード |
| `POSTGRES_DATABASE` | DB 名 |

## 出力値

`terraform apply` 後、以下の情報が出力されます：

```bash
terraform output
```

| 出力 | 説明 |
|------|------|
| `project_id` | Vercel プロジェクト ID |
| `production_url` | 本番 URL |
| `google_oauth_redirect_uris` | Google OAuth に設定する URI 一覧 |

## Google OAuth 設定

`terraform output google_oauth_redirect_uris` の出力を
Google Cloud Console の OAuth リダイレクト URI に追加してください。

https://console.cloud.google.com/apis/credentials

## トラブルシューティング

### "Could not create project, unexpected error: bad_request"

GitHub App がインストールされていません：
https://github.com/apps/vercel

### "Invalid API token"

環境変数を確認：
```bash
echo $VERCEL_API_TOKEN
```

### DATABASE_URL が設定されない

Vercel Postgres 作成後、`$POSTGRES_URL` の展開が必要な場合があります。
Vercel ダッシュボードで `POSTGRES_URL` の値を確認し、
必要に応じて `DATABASE_URL` を直接設定してください。

## 参考リンク

- [Vercel Terraform Guide](https://vercel.com/guides/integrating-terraform-with-vercel)
- [Vercel Provider - Terraform Registry](https://registry.terraform.io/providers/vercel/vercel/latest)
- [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres)
