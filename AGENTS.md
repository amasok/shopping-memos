# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

家族と共有できるお買い物メモ帳アプリ。Next.js製のPWA（Progressive Web App）として、スマホにインストールして使用する。

### 主な機能
- ユーザー認証（ログイン/ログアウト）
- 買い物リストの作成・編集・削除
- 家族間でのリスト共有

## 技術スタック

- **フレームワーク**: Next.js 16 (App Router)
- **認証**: NextAuth.js v5 (Auth.js)
- **データベース**: Prisma 7 + PostgreSQL 16
- **スタイリング**: Tailwind CSS
- **PWA**: next-pwa
- **ランタイム**: Node.js 22.22.0 (asdf)

## 開発コマンド

```bash
# 初回セットアップ
docker compose up -d          # PostgreSQL起動
npm install                   # 依存関係インストール
cp .env.example .env          # 環境変数設定
npx prisma migrate dev        # DBマイグレーション

# 開発
npm run dev                   # 開発サーバー (http://localhost:3000)
npm run build                 # プロダクションビルド
npm run start                 # プロダクションサーバー
npm run lint                  # ESLint

# Prisma
npx prisma migrate dev        # マイグレーション作成・適用
npx prisma generate           # クライアント生成
npx prisma studio             # DB GUI (http://localhost:5555)

# Docker
docker compose up -d          # PostgreSQL起動
docker compose down           # PostgreSQL停止
```

## アーキテクチャ

```
src/
├── app/                 # Next.js App Router
│   ├── api/            # APIルート
│   │   └── auth/       # NextAuth.js認証エンドポイント
│   ├── (auth)/         # 認証関連ページ（ログイン等）
│   └── (main)/         # 認証後のメインページ
├── components/         # Reactコンポーネント
├── lib/                # ユーティリティ、DB接続等
├── generated/prisma/   # Prisma生成クライアント（自動生成）
└── types/              # TypeScript型定義

prisma/
├── schema.prisma       # データベーススキーマ
├── migrations/         # マイグレーションファイル
└── prisma.config.ts    # Prisma設定（接続URL等）
```

### データモデル

- **User**: ユーザー情報（NextAuth連携）
- **Family**: 家族グループ
- **FamilyMember**: ユーザーと家族の関連（role: owner/member）
- **ShoppingList**: 買い物リスト（家族に紐づく）
- **ShoppingItem**: リスト内のアイテム
