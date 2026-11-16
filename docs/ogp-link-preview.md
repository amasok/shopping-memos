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
| F-8 | OGPが取得できない場合（理由を問わない。Amazon・タイムアウト・403・OGP なし など）は、カードを出さない。ホームと買い物リストではメモ本文の URL リンクだけで代替し、ItemForm（入力フォーム）では「リンクだけのカード」（ドメインと URL）を表示する（#140） | 必須 |
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
| N-7 | 読み込む大きさの上限：展開後 2MiB（gzip / br を受け付けて展開する。zip bomb 対策で展開後の大きさで数える。`</head` を読んだらそこで打ち切る。YouTube は og タグが 800KB 付近にあるため、#108 の 512KB から戻した） |

### 2.3 スコープ外（今回は実装しない）

- OGPデータのDBへの永続化

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
**取得失敗時**:
- ホーム・買い物リスト（MemoText）: カードは表示せず、MemoText の URL リンクのみで代替（本文にリンクがあるので何も足さない）
- ItemForm: 「リンクだけのカード」を表示する（#140。下記）

#### リンクだけのカード（#140、実装済み）

ItemForm で OGP を取得できなかったときの表示（メモは textarea でリンクにならないため）。`OGPPreview` の `fallback="link"` で有効にし、既定（`"none"`）は従来どおり何も出さない。失敗の理由（Amazon の 422、タイムアウトの 500、相手の 403 を受けた 422、通信エラーなど）で分けず、`/api/ogp` が 2xx 以外を返したら、またはリクエスト自体が失敗したら、すべてこの表示にする。特定のドメインをクライアントで判定しない（Amazon の判定はサーバーの 422 だけ）。

```
┌─────────────────────────────────────────┐
│ 🔗  item.rakuten.co.jp                   │
│     https://item.rakuten.co.jp/book/…    │  ← 1 行で省略
└─────────────────────────────────────────┘
  全体タップで target="_blank" でURL開く（カードと同じ）
  data-testid="ogp-link-fallback"
```

- アイコンは lucide-react の `Link`。ドメインは `new URL(url).hostname`（解析できなければ URL をそのまま）
- チェック済み（checked=true）はカードと同じく opacity-50 と line-through
- 外部の画像は読まない（favicon も取りに行かない）
- 経緯: 以前は失敗時にカードを消し、メモ本文の URL リンクだけを残していた（Amazon も同じ）。入力フォーム（ItemForm）のメモは textarea でリンクにならないため、失敗すると何も出ず、楽天などではスケルトンが最大 8 秒出てから消えるだけで、取得できなかったことが分からなかった。
  ホームと買い物リストは本文のリンクと重なるため、カードを足さない（リーダー承認、2026-11-17）

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

検証した IP にだけ接続する（DNS リバインディング対策、#108）。名前解決で返った全アドレスを検証し、**IPv4 を先にして全件を接続先に渡す**（`autoSelectFamily` で順に試す）。
Vercel の Functions は IPv6 で外に出られないため、先頭の 1 件だけに固定すると、AAAA が先に返るサイト（Cloudflare 配下の zenn.dev など）で接続に失敗していた。

### 3.10 Amazon対応

Amazonの商品ページはOGPタグを持たない。また、**VercelのIPアドレス（AWSのIPレンジ）をボットとして検出しHTTP 500を返す**ため、通常の直接fetchでは取得できない。

#### microlink.io 経由での取得（根本解決策）

Amazon URLを検出した場合は [microlink.io](https://microlink.io/) API経由でOGPデータを取得する。
microlink.io はAmazonのボット検出を回避して商品情報を返す。

```typescript
// Amazon URLの場合はmicrolink.io経由
if (isAmazonUrl(url)) {
  const ogpData = await fetchOGPViaMicrolink(url)
  if (!ogpData) {
    return NextResponse.json({ error: "Failed to fetch OGP data" }, { status: 422 })
  }
  return NextResponse.json(ogpData, { ... })
}
```

**制約**: 無料枠は50リクエスト/日。超過時は `null` が返り、OGPカードは非表示（URLリンクのみ）となる。

#### タイトル・説明文のフォールバック

AmazonにはOGPタグがないため、以下の優先順位でフォールバック取得する：

| 優先順位 | 取得元 | 備考 |
|----------|--------|------|
| 1 | `<meta property="og:title">` | 通常のOGP（Amazonには存在しない） |
| 2 | `<title>` タグ | Amazon商品ページには商品名が入る |
| 3 | `<meta name="title">` | `<meta name="title" content="Amazon.co.jp">` が存在するため最後 |

`<meta name="title">` はサイト名（"Amazon.co.jp"）のみを含む場合があるため、`<title>` タグより後に評価する。

#### 商品画像の取得

Amazonの商品画像はOGP画像タグがなく、`data-a-dynamic-image` 属性から取得する：

```html
<img data-a-dynamic-image='{"https://example.com/img_679.jpg":[679,679],"https://example.com/img_300.jpg":[300,300]}' />
```

複数サイズが含まれるため、**最大幅の画像URL**を選択して返す。

#### Content-Type ヘッダー省略問題

AmazonはVercelサーバーからのリクエストに対し、`Content-Type` ヘッダーを省略してレスポンスを返す場合がある。
空の `Content-Type` を `text/html` 以外と判定して弾かないよう、**`Content-Type` が空の場合はHTMLとして処理を続行**する。

```typescript
// 誤り（Amazonで弾かれる）
if (!contentType.includes("text/html")) { ... }

// 正しい実装
if (contentType !== "" && !contentType.includes("text/html")) { ... }
```

#### 大きなページサイズへの対応

Amazonの商品ページは1〜2MBに達するため、サイズ制限を1MBから5MBに拡張。
ただしDoS対策のため `response.body.getReader()` でストリーム読み込みし、5MBを超えた時点で即座に打ち切る。

#### リクエストヘッダー

AmazonはBotっぽいUser-Agentを識別してページを返さないことがある。Chrome実UAを使用する：

```
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...
Accept-Language: ja,en-US;q=0.9,en;q=0.8
Accept-Encoding: gzip, br   // #140 で identity から変更。展開は「3.11 圧縮された応答」
```

### 3.11 圧縮された応答（#140、実装済み）

`Accept-Encoding: identity` だけを求めると応答しないサイトがあるため、gzip と br を受け付けて、サーバーで展開する。

- `Content-Encoding` は前後の空白を除き、大文字小文字を区別せずに見る。`gzip` / `x-gzip` は gunzip、`br` は Brotli で展開する。空・`identity` はそのまま読む
- 送っていない方式（`deflate`・`zstd`・`gzip, br` のような重ねがけなど）は 422
- 上限（2MiB）は**展開後**の大きさで数える。達したら展開と接続を止める（zip bomb 対策）
- 途中で切れたデータは、展開できたところまでで解析する（`finishFlush` に SYNC_FLUSH を指定して、末尾が欠けてもエラーにしない）。og タグが含まれていれば 200
- 壊れたデータ（展開できない）は 422
- 複数の gzip メンバーが続く応答（空のメンバーを含む）は、続けて展開する（Node の gunzip の既定の動き）
- それでも楽天・ニトリは応答しない（相手のボット対策）。この場合は「リンクだけのカード」になる

---

## 4. テスト計画

| テスト種別 | 対象ファイル | テスト内容 |
|-----------|-------------|-----------|
| Unit | `src/lib/utils/url.ts` | URL抽出の正常系・異常系（URLなし、複数URL、日本語混在） |
| Unit | `src/app/api/ogp/route.ts` | SSRF対策、タイムアウト、レスポンス形式 |
| Unit | `OGPPreview.tsx` | ローディング・エラー・正常表示の各状態。`fallback="link"` の失敗（422 / 500 / 通信エラー）ではリンクだけのカード、既定では何も出さない（#140） |
| Unit | `src/app/api/ogp/route.ts` | 圧縮された応答: gzip / x-gzip / br、大文字・空白、zip bomb、途中で切れたデータ、空のメンバーが続く gzip、壊れたデータ、未対応の方式（#140） |
| E2E | `e2e/ogp-preview.spec.ts` | L-4（ホームは取得失敗時にカードなし・URL リンクのみ）は維持。ItemForm で取得失敗時にリンクだけのカードが出るテストを追加（#140） |
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
