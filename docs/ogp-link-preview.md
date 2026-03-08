# URLリンクプレビュー（OGP取得）機能 設計書

## 1. 機能概要

アイテムのメモフィールドにURLが含まれる場合、以下の挙動を実現する：

- URLを自動的にタップ可能なリンクとして表示する
- そのURLのOGPタグ（Open Graph Protocol）を取得し、リンクプレビューカードをメモの下に表示する

---

## 2. 要件定義

### 2.1 機能要件

| # | 要件 | 優先度 |
|---|------|--------|
| F-1 | メモのテキストからURLを検出する | 必須 |
| F-2 | メモ内のURLをタップ可能なリンクとして表示する（自動リンク化） | 必須 |
| F-3 | 検出したURLのOGPデータ（title / description / image）を取得する | 必須 |
| F-4 | アイテムリスト（ホーム画面）でOGPプレビューカードを表示する | 必須 |
| F-5 | 買い物リスト画面でもOGPプレビューカードを表示する | 必須 |
| F-6 | ItemFormの入力中にもOGPプレビューカードを表示する | 必須 |
| F-7 | プレビューカードをタップすると新しいタブでURLを開く | 必須 |
| F-8 | OGPが取得できない場合はシンプルなURLリンクのみを表示する | 必須 |
| F-9 | メモに複数URLがある場合は最初の1件のみプレビュー対象とする | 必須 |
| F-10 | 買い物リストでチェック済みアイテムのOGPプレビューに打ち消し線スタイルを適用する | 必須 |
| F-11 | ItemSelectorのアイテム一覧でもプレビューを表示する | 任意 |

### 2.2 非機能要件

| # | 要件 |
|---|------|
| N-1 | OGP取得はサーバーサイドで行う（CORS回避） |
| N-2 | ゲストモード（Dexie/IndexedDB）でも利用可能 |
| N-3 | タイムアウトは5秒以内 |
| N-4 | レスポンスは60秒キャッシュ（同一URLへの重複リクエスト抑制） |
| N-5 | SSRF対策：プライベートIPアドレスへのアクセスを禁止 |
| N-6 | URLはhttpまたはhttpsのみ許可 |
| N-7 | レスポンスサイズ上限：1MB |

### 2.3 スコープ外（今回は実装しない）

- OGPデータのDBへの永続化
- OGPなし時のフォールバック表示（`<title>` タグ等の代替取得）

---

## 3. 設計

### 3.1 アーキテクチャ

```
アイテム表示コンポーネント
  └─ <MemoText memo={memo} />        ← URLをリンク化 + OGPPreview
       ├─ テキスト部分（URLはaタグ化）
       └─ <OGPPreview url={firstUrl} checked={checked} />
            └─ useQuery: GET /api/ogp?url=...（TanStack Query）
                 └─ Next.js Route Handler: /api/ogp/route.ts
                      └─ 外部サイト HTML を fetch
                           └─ OGPタグをパースして返す

ItemForm（入力中プレビュー）
  └─ メモのtextareaの下に
     <OGPPreview url={extractFirstUrl(memo)} />
```

### 3.2 新規作成ファイル

```
src/
├── app/
│   └── api/
│       └── ogp/
│           └── route.ts                    # OGP取得APIエンドポイント
├── components/
│   └── features/
│       └── items/
│           ├── OGPPreview.tsx              # OGPプレビューカード
│           └── MemoText.tsx               # メモのURLリンク化 + OGPPreview統合
└── lib/
    └── utils/
        └── url.ts                          # URL抽出ユーティリティ
```

### 3.3 変更対象ファイル

```
src/app/page.tsx                            # ホーム：memo表示を<MemoText>に置換
src/app/lists/[id]/page.tsx                 # 買い物リスト：memo表示を<MemoText>に置換
src/components/features/items/ItemForm.tsx  # 入力中プレビューを追加
src/components/features/items/ItemSelector.tsx  # 任意：一覧にプレビュー追加
```

### 3.4 API仕様

**エンドポイント**: `GET /api/ogp`

```
リクエスト:
  ?url=https%3A%2F%2Fexample.com    (URLエンコードされたURL)

レスポンス 200:
{
  "url": "https://example.com",
  "title": "Example Domain",
  "description": "This is an example.",
  "image": "https://example.com/og-image.jpg",
  "siteName": "Example"
}

レスポンス 400:  URLが不正（プライベートIP、http/https以外等）
レスポンス 422:  OGPなし（URLは有効だがOGPタグが存在しない）
レスポンス 500:  取得失敗（タイムアウト等）

Cache-Control: public, max-age=60, s-maxage=3600
```

### 3.5 MemoText コンポーネント

```tsx
// メモのテキスト内URLを自動リンク化し、最初のURLにOGPPreviewを表示
<MemoText memo={item.memo} checked={false} />
```

- テキスト部分：URLをパースしてURLはaタグ、それ以外はspanに分割
- OGPPreview：extractFirstUrl() で最初のURLだけを対象にプレビュー表示

### 3.6 OGPPreview カードのUI

```
┌─────────────────────────────────────────┐
│ ┌──────┐  タイトル（1行で省略）          │
│ │ OG   │  説明文（2行で省略）            │
│ │ 画像 │  example.com                   │
│ └──────┘                                │
└─────────────────────────────────────────┘
  ↑ 画像なし時：左端のアクセントバー + テキストのみ
  全体タップで target="_blank" でURL開く

チェック済み状態（checked=true）の場合:
  - カード全体に opacity-50
  - テキストに line-through スタイル
```

**ローディング中**: スケルトンUI（グレーの矩形）を表示
**取得失敗時**: カードは表示せず、MemoTextのURLリンクのみで代替

### 3.7 URL抽出ユーティリティ

```typescript
// src/lib/utils/url.ts

// メモテキストからURLを検出する正規表現
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g

// テキストから最初のURLを1件取り出す
export function extractFirstUrl(text: string): string | null

// テキストをURL部分と非URL部分に分割する（リンク化用）
export function splitByUrls(text: string): Array<{ type: 'text' | 'url'; value: string }>
```

### 3.8 クライアントサイドのデータフェッチ

SWRは使用しない。プロジェクト既存の **TanStack Query**（`@tanstack/react-query`）の `useQuery` を使用する。

```typescript
const { data, isLoading, isError } = useQuery({
  queryKey: ['ogp', url],
  queryFn: () => fetch(`/api/ogp?url=${encodeURIComponent(url)}`).then(r => r.json()),
  staleTime: 1000 * 60,        // 60秒キャッシュ
  retry: 0,                    // エラー時はリトライしない
  enabled: !!url,
})
```

### 3.9 SSRF対策（APIサーバーサイド）

以下のIPアドレス範囲へのアクセスを禁止する（DNSルックアップ後にIPを検証）：

| 範囲 | 用途 |
|------|------|
| `127.0.0.0/8` | ループバック |
| `10.0.0.0/8` | プライベート |
| `172.16.0.0/12` | プライベート |
| `192.168.0.0/16` | プライベート |
| `169.254.0.0/16` | リンクローカル |
| `::1` | IPv6ループバック |

---

## 4. テスト計画

| テスト種別 | 対象ファイル | テスト内容 |
|-----------|-------------|-----------|
| Unit | `src/lib/utils/url.ts` | URL抽出の正常系・異常系（URLなし、複数URL、日本語混在） |
| Unit | `src/app/api/ogp/route.ts` | SSRF対策、タイムアウト、レスポンス形式 |
| Unit | `OGPPreview.tsx` | ローディング・エラー・正常表示の各状態 |
| Unit | `MemoText.tsx` | URLリンク化の正常系（テキスト分割） |
| E2E | ホーム画面 | URLを含むアイテムにプレビューが表示される |

---

## 5. 実装順序

```
Step 1: src/lib/utils/url.ts              URL抽出ユーティリティ
Step 2: src/app/api/ogp/route.ts          OGP取得APIエンドポイント
Step 3: src/components/.../OGPPreview.tsx プレビューカードコンポーネント
Step 4: src/components/.../MemoText.tsx   URLリンク化 + OGPPreview統合
Step 5: src/app/page.tsx                  ホーム画面に適用
Step 6: src/app/lists/[id]/page.tsx       買い物リストに適用（チェック済みの打ち消し線含む）
Step 7: ItemForm.tsx                      入力中プレビュー追加
Step 8: テストコード追加
```
