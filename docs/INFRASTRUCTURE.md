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

## 6.5 メールのコードでのログイン（Better Auth・Resend・Turnstile。#61 A3a）

AR1b（A3a・A3b・A4）のリリースの前に、次をそろえる。Google OAuth の値（`NEXTAUTH_SECRET`・`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`）は、Auth.js のデプロイに Promote で戻せるよう、A6（contract）まで消さない。

### Vercel の環境変数

| 変数 | 値 | Production | Preview |
|------|----|-----------|---------|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`（32 文字以上） | ○ | ○（本番と別の値） |
| `BETTER_AUTH_URL` | `https://shopping.counoco.net` / Preview は develop の固定 URL | ○ | ○ |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Preview のほかのホスト（カンマ区切りのオリジン） | — | 必要なら |
| `OTP_EVENT_HMAC_KEY` | `openssl rand -base64 32`（`BETTER_AUTH_SECRET` と別の値） | ○ | ○ |
| `TURNSTILE_SECRET_KEY` | Turnstile の非表示のウィジェットの secret | ○（テスト用のキーは起動時に拒否） | テスト用のキー `1x0000000000000000000000000000000AA` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | 同じウィジェットのサイトキー（ビルド時に埋め込まれる） | ○ | テスト用のキー `1x00000000000000000000AA` |
| `RESEND_API_KEY` | Resend の API キー（送信だけの権限） | ○ | ○ |
| `EMAIL_FROM` | `買い物メモ <noreply@mail.counoco.net>` | ○ | ○ |
| `EMAIL_RECIPIENT_ALLOWLIST` | 家族と開発者のアドレス（カンマ区切り） | 設定しない | ○（必須） |
| `OTP_ALERT_EMAIL` | 送信数のアラートの宛先（A3b） | ○ | 任意 |

- 欠けていると、サーバーの起動時（`src/instrumentation.ts`）に AuthConfigError / EmailConfigError で止まり、**ゲストの画面も含めてサイト全体が 500 になる**。Vercel の環境変数を入れてからデプロイする。落ちたら、前のデプロイに Promote で戻してから値を直す
- Vercel（Production・Preview）では、`BETTER_AUTH_URL`・`BETTER_AUTH_TRUSTED_ORIGINS` は https だけ、`BETTER_AUTH_SECRET`・`OTP_EVENT_HMAC_KEY` に CI・開発用のダミー（`not-for-production`・`dev-only` などを含む値）は使えない
- `E2E_BUILD`・`E2E_TEST`・`E2E_SEED_TOKEN` は Vercel に設定しない

### ユーザーの作業

- [ ] Cloudflare で Turnstile のウィジェット（非表示）を作り、ホストに `shopping.counoco.net` を入れる。Preview はテスト用のキーを使う
- [ ] Resend に `mail.counoco.net` を追加し、表示される SPF・DKIM と DMARC（`p=none` から）を Cloudflare の DNS に登録して、検証を通す
- [ ] Preview に Deployment Protection（Vercel Authentication）をかける（Preview は Turnstile がテスト用のキーで常に通るため）
- [ ] `shopping.counoco.net` の CNAME は DNS only（プロキシ OFF）のままにする。プロキシを ON にすると、IP がすべて Cloudflare のものになり、IP ごとの上限が全員で 1 つになる

### AR1b の Preview の確認項目（PR の本文に写す）

```markdown
- [ ] ログイン画面に Google のボタンがなく、移行の案内が出る
- [ ] 既存ユーザーの Gmail アドレス（許可リストに入れたもの）にコードが届き、ログインできる
- [ ] ログイン後、既存のグループ・アイテム・リスト・履歴がそのまま見える（同じユーザーとして紐付いている）
- [ ] 誤ったコードを 3 回入れると無効になり、再送できる。再送ボタンは 60 秒間押せない
- [ ] ログアウトするとゲストモードに戻る
- [ ] iPhone のホーム画面に追加した状態でも、コード入力でログインが完結する
- [ ] 許可リスト外のアドレスでは、メールが届かない（画面の表示は同じ）
- [ ] 偽の `x-real-ip`・`x-forwarded-for` を付けたコードの送信で、記録される IP（`otp_events.ip`・`rate_limits.key`）がクライアントの値にならない（例: `curl -X POST <Preview>/api/auth/email-otp/send-verification-otp -H 'origin: <Preview>' -H 'x-real-ip: 192.0.2.123' -H 'x-forwarded-for: 192.0.2.124' -H 'x-turnstile-token: x' -H 'content-type: application/json' -d '{"email":"<許可リストのアドレス>","type":"sign-in"}'` の後、Preview の DB で `select ip from otp_events order by created_at desc limit 1` と `select key from rate_limits order by last_request desc limit 1` が 192.0.2.123・192.0.2.124 でないこと）
- [ ] ブラウザの開発者ツールで、ログイン画面と Turnstile の CSP（Report-Only）の違反が出ない
```

（表示名の設定・すべての端末からログアウトは A4 の項目で足す）

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
| 2026-11-18 | 2.1 | メールのコードでのログイン（#61 A3a）の環境変数・ユーザーの作業・AR1b の確認項目を追加 |
