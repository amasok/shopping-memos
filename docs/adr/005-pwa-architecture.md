# ADR-005: PWAアーキテクチャ

## ステータス

**提案中**

## コンテキスト

買い物メモアプリはオフラインファーストPWAとして設計されている。Service WorkerによるキャッシュとA2HS（ホーム画面に追加）機能を実装する必要がある。

### 現状

- ローカルDB: Dexie（IndexedDB）で全機能が動作
- 全ページが `'use client'`（CSR）
- `next-pwa` がインストール済みだが未設定
- Web App Manifestなし
- Service Workerなし

### 要件

1. オフラインで全ページが動作すること（画面遷移含む）
2. ホーム画面に追加（A2HS）対応
3. Service WorkerでJSチャンク・静的アセットを事前キャッシュ
4. 無料ホスティング（Vercel）を前提

### 制約

- Next.js 16（Turbopack がデフォルト）
- 既存のIndexedDB（Dexie）アーキテクチャと共存

## 検討した選択肢

### 1. next-pwa v5.6.0（既存パッケージ）

**メリット**:
- 既にインストール済み
- 設定がシンプル

**デメリット**:
- Turbopack非互換（webpack-pluginに依存）
- メンテナンス停止（最終リリース2022年）
- App Router非対応

### 2. @ducanh2912/next-pwa（next-pwaフォーク）

**メリット**:
- next-pwaからの移行が容易

**デメリット**:
- 同じ問題を抱える（Turbopack非互換）
- 実績が少ない

### 3. カスタムService Worker

**メリット**:
- 完全な制御
- 依存なし

**デメリット**:
- プリキャッシュマニフェストの手動管理が煩雑
- Next.jsのビルドとの統合が難しい

### 4. Serwist（@serwist/next）

**メリット**:
- next-pwa/workbox-webpack-pluginの後継
- Next.js 16対応（productionビルド）
- プリキャッシュ自動生成
- API互換性が高く移行コストが低い
- npm weekly downloads 55,000+で実績あり

**デメリット**:
- 開発環境では`--webpack`フラグが必要（ただしSW無効化で問題なし）

## 決定

**Serwist（@serwist/next）を採用する**

- `next-pwa` をアンインストール
- `@serwist/next` + `serwist` をインストール
- プリキャッシュで全ページのオフライン対応を実現

## 理由

### 1. Next.js 16互換性

next-pwaはTurbopack非互換で動作しない。Serwistはproductionビルドで互換性あり。

### 2. オフラインファーストとの親和性

| 責務 | 担当 |
|------|------|
| アセットキャッシュ (HTML/JS/CSS) | Service Worker (Serwist) |
| アプリケーションデータ | IndexedDB (Dexie) |
| オフライン時の操作記録 | syncQueue (Dexie) |
| オンライン復帰時の同期 | アプリケーション層 (React) |

Service Workerはアプリケーションデータに関与しない。ADR-004の同期戦略と完全に分離できる。

### 3. 全ページがCSR

全ページが `'use client'` でデータはIndexedDBから取得するため、HTMLシェル + JSチャンクさえキャッシュすればオフラインで完全動作する。

## アーキテクチャ

### 概要

```
┌─────────────────────────────────────────────────────────────┐
│                       Service Worker                        │
│  ┌────────────────────┐  ┌────────────────────────────────┐│
│  │    Precache        │  │      Runtime Cache             ││
│  │  ・/_next/static/* │  │  ・Navigation: NetworkFirst   ││
│  │  ・/icons/*        │  │  ・API: NetworkOnly            ││
│  │  ・全ページパス     │  │  ・Images: StaleWhileRevalidate││
│  └────────────────────┘  └────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐ │
│  │   React     │───→│   Dexie     │───→│   Sync Queue    │ │
│  │ Components  │    │ (IndexedDB) │    │                 │ │
│  └─────────────┘    └─────────────┘    └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### キャッシュ戦略

#### 事前キャッシュ（Precache）

Serwistがビルド時に自動生成:

| 対象 | 説明 |
|------|------|
| `/_next/static/**/*.js` | Next.js JSチャンク |
| `/_next/static/**/*.css` | CSSファイル |
| `/icons/*` | PWAアイコン |

`additionalPrecacheEntries` で追加:

```
/              (ホーム)
/lists         (リスト一覧)
/lists/new     (リスト作成)
/tags          (タグ管理)
/settings      (設定)
/history       (購入履歴)
/groups        (グループ一覧)
/items/new     (アイテム追加)
/login         (ログイン)
/offline       (オフラインフォールバック)
```

#### ランタイムキャッシュ

| リソース | 戦略 | 理由 |
|---------|------|------|
| ページナビゲーション | NetworkFirst → Cache → /offline | 最新優先、オフライン時はキャッシュ |
| Next.js静的アセット | CacheFirst | ハッシュ付きで変更時にURL変わる |
| フォント | CacheFirst (1年) | 変更頻度が極めて低い |
| 画像 | StaleWhileRevalidate | UXとデータ鮮度のバランス |
| tRPC API | NetworkOnly | IndexedDBと二重管理を防ぐ |
| 認証API | NetworkOnly | セッション情報はキャッシュ不可 |

### tRPC APIをNetworkOnlyにする理由

データの信頼できる唯一のソース（SSOT）はIndexedDB（Dexie）である。

- **オンライン時**: tRPCでサーバー同期 → IndexedDBに反映 → UIはIndexedDBから表示
- **オフライン時**: tRPC呼び出しはスキップ → IndexedDBのローカルデータを表示

tRPCレスポンスをService Workerでキャッシュすると、IndexedDBと二重管理になり整合性の問題が生じる。

### 動的ルートの対応

`/lists/[id]`, `/groups/[id]` のHTMLシェルは事前キャッシュできないが、問題にならない。

1. クライアントサイドナビゲーションでJSチャンク（事前キャッシュ済み）を使用
2. データはIndexedDBから取得（ネットワーク不要）
3. 一度アクセスしたページはランタイムキャッシュに入る

## ファイル構成

### 新規作成

```
public/
  icons/
    icon-72x72.png
    icon-96x96.png
    icon-128x128.png
    icon-144x144.png
    icon-152x152.png
    icon-192x192.png
    icon-384x384.png
    icon-512x512.png
    icon-192x192-maskable.png
    icon-512x512-maskable.png

src/
  app/
    manifest.ts                    # Web App Manifest
    sw.ts                          # Service Worker ソース
    offline/
      page.tsx                     # オフラインフォールバックページ

  components/
    pwa/
      RegisterSW.tsx               # Service Worker登録
      InstallPrompt.tsx            # A2HSインストールプロンプト
      OfflineIndicator.tsx         # オフライン状態バナー

  hooks/
    useOnlineStatus.ts             # オンライン/オフライン検知
    useInstallPrompt.ts            # beforeinstallpromptイベント
```

### 変更

```
next.config.ts                     # withSerwistInit でラップ
src/app/layout.tsx                 # metadata追加、RegisterSW配置
package.json                       # 依存関係の入れ替え
.gitignore                         # Serwist生成ファイル除外
```

## Web App Manifest

```typescript
// src/app/manifest.ts
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'お買い物メモ',
    short_name: '買い物メモ',
    description: '家族と共有できるお買い物メモアプリ',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#3b82f6',
    orientation: 'portrait',
    lang: 'ja',
    categories: ['lifestyle', 'shopping'],
    icons: [
      { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-192x192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
```

## アイコンサイズ

| サイズ | purpose | 用途 |
|--------|---------|------|
| 72x72 | any | Android低解像度 |
| 96x96 | any | Android |
| 128x128 | any | Chrome Web Store |
| 144x144 | any | Windowsタイル |
| 152x152 | any | iOS (apple-touch-icon) |
| 192x192 | any | Androidホーム画面（必須） |
| 384x384 | any | Androidスプラッシュ |
| 512x512 | any | Androidスプラッシュ（必須） |
| 192x192 | maskable | Androidアダプティブアイコン |
| 512x512 | maskable | Androidアダプティブアイコン |

## オフラインUI

### OfflineIndicator

オフライン時にページ上部にバナー表示:

```
「オフラインモード - 接続回復時に自動同期します」
```

### オフラインフォールバックページ

未キャッシュのページへのナビゲーション時に表示:

```
「インターネット接続がありません」
+ キャッシュ済みページへのリンク
```

## 実装フェーズ

### Phase 1: 基盤セットアップ

- [ ] `next-pwa` アンインストール、`@serwist/next` + `serwist` インストール
- [ ] `src/app/manifest.ts` 作成
- [ ] アイコン画像を `public/icons/` に配置
- [ ] `next.config.ts` に `withSerwistInit` 設定
- [ ] `src/app/sw.ts` 作成
- [ ] `src/app/layout.tsx` にmetadata追加
- [ ] `.gitignore` に生成ファイル追加

**完了条件:** `npm run build` 成功、`public/sw.js` 生成

### Phase 2: オフライン対応

- [ ] `src/app/offline/page.tsx` 作成
- [ ] `src/hooks/useOnlineStatus.ts` 作成
- [ ] `src/components/pwa/OfflineIndicator.tsx` 作成
- [ ] `src/components/pwa/RegisterSW.tsx` 作成
- [ ] `additionalPrecacheEntries` に全ページパス追加
- [ ] オフライン動作テスト

**完了条件:** 機内モードで全ページが表示・操作可能

### Phase 3: インストール体験（A2HS）

- [ ] `src/hooks/useInstallPrompt.ts` 作成
- [ ] `src/components/pwa/InstallPrompt.tsx` 作成
- [ ] iOS Safari向け apple-touch-icon 追加

**完了条件:** Android/iOS でホーム画面に追加でき、standalone起動

### Phase 4: 品質・最適化

- [ ] Lighthouse PWA監査で90+達成
- [ ] Service Worker更新フロー実装
- [ ] Vercelデプロイでの動作確認
- [ ] テスト作成

**完了条件:** Lighthouse PWA 90+

## 影響

### ポジティブ

- オフラインで全ページが動作
- ホーム画面からアプリとして起動可能
- 初回以降の読み込みが高速化

### ネガティブ

- Service Worker更新時のキャッシュ問題に注意が必要
- 開発環境でのSWデバッグが複雑

### 対策

- SW更新時にユーザーに通知して再読み込みを促す
- 開発時はSWを無効化

## 開発環境の注意点

| 項目 | 対応 |
|------|------|
| 開発中のService Worker | `disable: process.env.NODE_ENV === 'development'` |
| PWAテスト | `npm run build && npm start` でproductionモード |
| Turbopack警告 | `.env` に `SERWIST_SUPPRESS_TURBOPACK_WARNING=1` |

## 参考資料

- [Next.js公式 PWAガイド](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Serwist公式ドキュメント](https://serwist.pages.dev/docs/next/getting-started)
- [@serwist/next npm](https://www.npmjs.com/package/@serwist/next)
