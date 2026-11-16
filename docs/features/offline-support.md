# オフライン対応（ログイン中の編集と復帰時の同期、Service Worker キャッシュ）

> ステータス: **設計レビュー待ち**（未承認・未実装）
> 関連 Issue: #62（本機能）、#44（PWA 対応）、#61（認証方式の変更。オフライン時のセッション扱いで連携）
> 関連 ADR: [ADR-004 オフライン同期戦略](../adr/004-offline-sync-strategy.md)（承認済み）、[ADR-005 PWA アーキテクチャ](../adr/005-pwa-architecture.md)（提案中）
> 関連セキュリティ Issue: #69（sync.push / merge の認可不備）、#64（同名アイテムの全ユーザー更新）、#68（itemId / tagId の所有権を検証していない）、#72（入力の上限・ページングがない）、#73-1（WHERE にスコープがない）、#71（セキュリティヘッダ）、#65（Next.js の脆弱性）。「## セキュリティ」節で対応関係を示す

## 概要

電波の悪いスーパーの店内でも、ログイン中・ゲストともにアプリを開いて**閲覧・追加・編集・チェック**ができ、オンラインに戻ったら変更が自動でサーバーへ反映されるようにする。

そのために次の 2 つを行う。

- Service Worker（Serwist）でアプリシェルをキャッシュする
- ログイン中のデータ操作を、**IndexedDB（Dexie）を正とするローカルファースト + 送信キュー（outbox）方式**に移す。これは ADR-004 が当初想定していた形で、現在は「C: 現状維持」で止まっている

> **前提（2026-11-16 確定）**: 本番は稼働している（Vercel の GitHub 連携で main → Production、develop → Preview）。本番には Google でログインしている家族ユーザーがいる。本機能で**本番に初めて Service Worker のキャッシュを入れる**ことになる。そのため、更新方法・キャッシュのバージョン管理・問題が起きたときに SW を無効化する手順（kill switch）を「### 3. Service Worker」に、リリースの単位と手順を「## 本番環境への影響とリリース手順」に書く

## 現状（2026-11-16 調査）

| 項目 | 状態 |
|------|------|
| `public/sw.js` | skipWaiting / clients.claim と素通しの fetch だけ（14 行）。**キャッシュがないため、ゲストでもオフラインではアプリが開かない** |
| SW 登録 | `src/components/pwa/RegisterSW.tsx` が `/sw.js` を登録（`layout.tsx`） |
| データソースの判定 | `useDataSource()`: `useServer = !!user && isMergeCompleted`。ログイン中は全 hook が tRPC を直接呼ぶ（楽観更新なし、`onSuccess` で invalidate） |
| Dexie | version 8。`syncQueue` テーブルはあるが `addToQueue` の呼び出し元はない。`updatedAt` は tags / items / groups のみ。`userId` / `deletedAt` はない。ID は `crypto.randomUUID()` |
| SyncEngine / SyncContext | API はある（`addToQueue`, `syncPendingOperations(pushFn)`, `pullChanges(pullFn)`）。しかし push/pull 関数が渡されておらず、`SyncProvider` も providers に組み込まれていない |
| tRPC `sync` ルーター | `push` は `sync_operations` に記録するだけで、エンティティのテーブルに反映しない。`pull({since, groupIds})` と `merge` がある。ログイン時のマージ（`DataMergeContext`）は `sync.merge` を使っていて、これは動いている |
| サーバースキーマ | `updated_at` は items / tags / groups / users のみ（shopping_lists / list_items にはない）。`deleted_at`（論理削除）はない。作成時の ID はサーバーで採番し、入力スキーマは `id` を受け付けない |
| 認証 | オフライン時は `useSession` が取得できず、`user = null` として**ゲストモードに切り替わってしまう** |
| Playwright | `serviceWorkers` オプションは未設定。webServer は `next dev`（開発時は SW が無効になるため、オフラインの E2E ができない） |

## ユーザーストーリー

- ユーザーとして、圏外でもホーム画面のアイコンからアプリを開き、買い物リストを見てチェックできる
- ユーザーとして、オフライン中にアイテムの追加・編集・削除、リストの作成、買い物完了ができる
- ユーザーとして、オンラインに戻ると、オフライン中の変更が自動でサーバーに送られ、家族の端末にも反映される
- ユーザーとして、未送信の変更があることと、オフライン状態であることが画面で分かる
- ユーザーとして、家族が追加したアイテムを手動更新（またはアプリを前面に戻したとき）で取得できる
- ユーザーとして、新しいバージョンが出たら案内され、好きなタイミングで更新できる

## UIフロー

```
【オフライン時】
  ┌──────────────────────────────────────────┐
  │ ⚠ オフライン — 変更はこの端末に保存されます  │ ← OfflineBanner（ヘッダー直下・控えめな色）
  ├──────────────────────────────────────────┤
  │ 買いたいもの                    ⟳ 未同期 3 │ ← SyncStatusBadge（未送信件数）
  │ ☐ 牛乳                                   │
  │ ☐ 卵                                     │
  └──────────────────────────────────────────┘
  ・グループの作成／参加／メンバー操作／招待コードの再生成 → ボタン無効化＋「オンライン時のみ利用できます」
  ・ログイン／ログアウト → オンライン時のみ

【オンライン復帰】
  online イベント → 自動 push → 自動 pull → バッジが「✓ 同期済み」になり、数秒後に消える

【手動更新】
  ヘッダーの ⟳ ボタン（ホーム・リスト一覧）→ push → pull → 「最新の状態です」トースト

【同期エラー】
  ・ネットワークエラー → 自動リトライ（ユーザーには見せず、バッジは「未同期」のまま）
  ・サーバーが操作を拒否（権限なし・削除済みグループなど）→ バッジが赤になる
       → タップ → ボトムシート「送信できなかった変更 N 件」
           ・内容（例:「牛乳 を追加」）と理由
           ・[破棄]（ローカルの値をサーバーの値に戻す）
  ・競合（他の端末の新しい更新が勝った）→ サーバーの値で上書きし、トースト「他の端末の変更を反映しました」

【セッション切れ（オンライン時に 401）】
  未送信の変更は保持 → バナー「ログインの有効期限が切れました［再ログイン］」
  → 同じユーザーで再ログイン → 自動 push

【ログアウト】
  未送信の変更がある → 確認ダイアログ「未送信の変更が N 件あります。ログアウトすると失われます」
     [同期してからログアウト]（オンライン時のみ）／[破棄してログアウト]／[キャンセル]
  → ログアウト後: ユーザー用の IndexedDB と SW のランタイムキャッシュを消去し、ゲストモードへ

【新バージョン】
  新しい SW が waiting → トースト「新しいバージョンがあります［更新］」→ skipWaiting → リロード
```

## 技術選定（選択肢と推奨）

### 1. ログイン中のデータアーキテクチャ

| 案 | 内容 | 評価 |
|----|------|------|
| **A. ローカルファースト + outbox（推奨）** | ログイン中も読み取りは常に Dexie（`useLiveQuery`）から行う。書き込みは Dexie と `syncQueue` に 1 トランザクションで記録し、SyncEngine が push / pull する | ゲストと同じ Dexie の経路に一本化でき、hook の tRPC 分岐がなくなる。オフラインで作ったリストをそのまま開いて買い物できる（ID はクライアントで採番）。ADR-004 の決定どおり。工数は大きい（hook の書き換えと sync API の実装） |
| B. TanStack Query の永続化 + 一時停止ミューテーション | `persistQueryClient`（IndexedDB に保存）+ `networkMode: "offlineFirst"` + `setMutationDefaults` + `resumePausedMutations` | hook の構造はほぼ維持できる。ただし全ミューテーションに楽観更新（複数クエリのキャッシュ書き換え）が必要になる。オフラインで作ったエンティティを別のミューテーションで参照すると、ID の解決が難しい。ゲストとログイン中で二重の実装が残る |
| C. Service Worker の BackgroundSync で tRPC の POST を再送 | Serwist の `BackgroundSyncPlugin` | **Safari / iOS は Background Sync API に未対応**（[web-features](https://web-platform-dx.github.io/web-features-explorer/features/background-sync)）。また読み取り側がオフラインで動かないため、要件を満たさない |

**推奨: A**。主な利用者が iOS を含むスマホで、「店内でリストを作ってそのまま買い物する」流れをオフラインで成立させるには、クライアントでの ID 採番とローカルの読み取りが必須なため。

### 2. 競合解決

前提は ADR-004 と同じ（主に夫婦 2 人、同時編集はまれ、リアルタイム性は不要）。

| 案 | 評価 |
|----|------|
| **パッチ送信 + レコード単位の LWW + 削除優先（推奨）** | 更新操作は**変更したフィールドだけ**を送る（例: `{checked: true}`）。サーバーは「操作時刻（クライアント時刻をサーバー時刻で補正したもの）≧ その行の `updated_at`」なら適用し、古ければ却下してサーバーの値を返す。削除は常に勝つ（tombstone）。別々のフィールドを同時に編集した場合（例: A がチェック、B がメモ編集）は、両方とも残りやすい |
| サーバーの受信順 LWW | 最も簡単。ただし長時間オフラインだった端末の古い編集が、新しい編集を上書きしてしまう |
| バージョン番号で競合を検出 → ユーザーに選ばせる | 確実だが、UI と実装が重い。買い物メモには過剰 |
| CRDT（Yjs / Automerge） | 過剰。サーバーの DB 設計とも合わない |

補足ルール:

- **時刻の補正**: push / pull のレスポンスで `serverTime` を返し、クライアントは `offset = serverTime − 受信時刻` を保持する。操作時刻は `Date.now() + offset` で記録する（端末の時計ずれ対策）
- **作成**: クライアントの UUID で冪等な upsert にする。同じ ID がすでにあれば、更新として扱う
- **同名アイテムの作成**: 両方残す（ADR-004 どおり）
- **`listItems.checked`**: チェック／チェック解除も上記の LWW に従う
- **買い物完了（finishShopping）**: リストの状態とアイテムの購入日時をまとめて変える複合操作。1 つの操作として送り、サーバーは 1 トランザクションで適用する

### 3. Service Worker（Serwist）

- 2026-11 時点で、Serwist 9.5.x には **Turbopack 対応の公式パッケージ `@serwist/turbopack`** がある（[docs](https://serwist.pages.dev/docs/next/turbo)）。これまでの `@serwist/next` は webpack 前提（Next.js 公式の PWA ガイドにも「webpack configuration が必要」とある）。本プロジェクトは Next.js 16 の既定（Turbopack）で `next build` しているので、**`@serwist/turbopack` を採用**する。ADR-005 の「`@serwist/next`」は更新が必要
- 構成（公式手順に準拠）:
  - `next.config.ts` を `withSerwist()`（`@serwist/turbopack`）でラップする
  - `src/app/serwist/[path]/route.ts` に `createSerwistRoute({ swSrc: "src/app/sw.ts", additionalPrecacheEntries, useNativeEsbuild: true })` を置き、`/serwist/sw.js` を配信する
  - `src/app/sw.ts` で `new Serwist({ precacheEntries: self.__SW_MANIFEST, navigationPreload: true, runtimeCaching, fallbacks })` を組み、`addEventListeners()` を呼ぶ
  - `layout.tsx` の `RegisterSW` を `<SerwistProvider swUrl="/serwist/sw.js">`（`@serwist/turbopack/react`）に置き換え、`public/sw.js` は削除する。既存ユーザーの `/sw.js` の登録は、新しい SW の登録時に解除する
- Next.js 16 の `experimental.useOffline` は experimental であり、ナビゲーションや Server Action の再試行が主目的で、本アプリのデータ同期の要件には合わないため採用しない

#### キャッシュ戦略

| 対象 | 戦略 | 理由 |
|------|------|------|
| `/_next/static/**`（ハッシュ付き JS/CSS） | Precache（ビルドのマニフェスト）+ CacheFirst | URL がビルドごとに変わるため |
| アプリシェル（`/`, `/lists`, `/lists/new`, `/lists/detail`, `/items/new`, `/history`, `/tags`, `/settings`, `/groups`, `/login`, `/~offline`） | `additionalPrecacheEntries`（revision = ビルド ID） | 全ページが `"use client"` で、HTML にユーザー固有のデータが入らないことを確認済み（サーバーで `auth()` を呼ぶのは tRPC の context だけ） |
| ページのナビゲーション（document） | NetworkFirst（タイムアウト 3 秒）→ キャッシュ → `/~offline` | オンラインなら最新、圏外ならすぐキャッシュで開く |
| RSC リクエスト（`RSC: 1` ヘッダ） | NetworkFirst（3 秒）→ キャッシュ | Serwist の `defaultCache` の matcher を流用する |
| 画像・フォント | StaleWhileRevalidate / CacheFirst（`defaultCache` に準拠） | |
| `/api/trpc/**` | **NetworkOnly** | データの正は Dexie。SW でもキャッシュすると二重管理になり、ユーザー固有データが Cache Storage に残る（ADR-005 と同じ判断）。`defaultCache` は `/api/` の GET を NetworkFirst でキャッシュするため、**この matcher は上書きして外す** |
| `/api/auth/**` | NetworkOnly | |
| `/api/e2e/**`, `/api/test/**` | NetworkOnly | テスト専用。キャッシュしない |
| `/api/ogp` | NetworkOnly | 未認証で呼べて、SSRF 対策に不備がある（#66）。#66 の修正とログインユーザー限定化が済むまではキャッシュしない |
| 上記以外の `/api/**` | NetworkOnly | 既定で API はキャッシュしない（allowlist 方式） |

- サーバー側でも、`/api/trpc` と `/api/auth` のレスポンスに `Cache-Control: private, no-store` を付ける（SW 以外の中間キャッシュ対策も兼ねる）

- **動的ルート `/lists/[id]`**: 一度も訪れていないリスト（オフラインで作成した直後のものを含む）は、HTML も RSC もキャッシュにないため開けない。**`/lists/detail?id=<id>` という静的ルートに変更**してプリキャッシュし、`useSearchParams` で ID を読む。旧 URL `/lists/[id]` はリダイレクトとして残す（ブックマーク対策）。`/groups/[id]` はオンライン限定の機能なので対象外とする
- **開発環境**: SW は無効にする（`next dev` ではキャッシュしない）。動作確認と E2E は `next build && next start` で行う

#### SW の更新方法

- **既定は「利用者が選んだときに切り替え」**。新しい SW が `waiting` になったら、トースト「新しいバージョンがあります［更新］」を出す。［更新］で `postMessage({type: "SKIP_WAITING"})` → SW が `skipWaiting()` → `controllerchange` でページを 1 回リロードする。自動で `skipWaiting` しないのは、買い物の途中で古いチャンクが消えて画面が壊れるのを避けるため
- トーストを無視しても、アプリのタブ・ウィンドウをすべて閉じれば、次回の起動時に新しい SW が有効になる（標準の挙動）
- **更新の確認**: ホーム画面の PWA は長時間開いたままになりやすい。そこで `visibilitychange`（前面に戻ったとき）と、開いている間は 1 時間ごとに `registration.update()` を呼ぶ
- SW の登録は `updateViaCache: "none"` にし、`/serwist/sw.js` は `Cache-Control: no-cache, no-store, must-revalidate` で配信する（Next.js 公式の PWA ガイドの推奨）。スクリプトの置き場所が `/serwist/` 配下でスコープが `/` なので、`Service-Worker-Allowed: /` ヘッダが付くことを E2E で確認する
- **既存の `/sw.js` からの移行**: 本番の利用者の端末には、今の素通しの `/sw.js` がスコープ `/` で登録されている。新しい SW を同じスコープ `/` で登録すると、同じ登録のスクリプトが置き換わる。`public/sw.js` は O1 で削除する（まだ古いページを開いている端末が `/sw.js` の更新を確認すると 404 になるが、素通しの SW が残るだけで害はない。次にページを開いたときに新しい SW に置き換わる）
- **クライアントとサーバーの互換性**: オフラインだった端末は、古いコードのまま数日後に push してくることがある。そこで `sync.push` / `sync.pull` の入力に `protocolVersion` を含める。サーバーは少なくとも 1 つ前のバージョンを受け付け、対応外のバージョンなら専用のエラーを返す。クライアントはそれを受けたら「アプリを更新してください」と表示し、更新を促す

#### キャッシュのバージョン管理

| キャッシュ | 管理方法 |
|-----------|---------|
| プリキャッシュ | エントリごとに revision を持つ。ハッシュ付きのアセットは URL 自体がビルドごとに変わる。アプリシェルの HTML の revision には、ビルド ID（`VERCEL_GIT_COMMIT_SHA`）を使う。新しい SW のインストール時に、変わったエントリだけ取得し直す。`cleanupOutdatedCaches` を有効にし、古いプリキャッシュを削除する |
| ランタイムキャッシュ | キャッシュ名に `sm-v1-` の接頭辞を付ける（`sm-v1-pages`, `sm-v1-rsc`, `sm-v1-images`, `sm-v1-fonts`）。matcher や戦略を互換性のない形で変えたら、`CACHE_VERSION` を上げる。`activate` で、`sm-` で始まり現在のバージョンと一致しないキャッシュを削除する |
| 上限 | `ExpirationPlugin` で件数と期間を制限する（pages / rsc: 50 件・7 日、images: 100 件・30 日、fonts: 10 件・1 年） |
| IndexedDB | SW のキャッシュとは別に、Dexie の `version()` で管理する（O6）。SW の kill switch では消さない（未送信の変更を守るため） |

#### kill switch（SW を無効化して戻す手順）

**前提として、Vercel の Promote で O1 より前のデプロイに戻しても、登録済みの SW は消えない。** 更新を確認したときに SW のスクリプトが 404 になっても、ブラウザは既存の SW を使い続ける（登録は解除されない）。そのため、SW の問題は**ロールバックではなく、kill switch を有効にしたビルドを新しくデプロイして直す**。

| 段階 | 方法 | 効果 | 使う場面 |
|------|------|------|---------|
| 1. 登録の停止 | 環境変数 `NEXT_PUBLIC_SW_ENABLED=false` で再デプロイする。`SerwistProvider` は SW を登録しない。代わりに `SWKillSwitch` コンポーネントが、既存の登録をすべて `unregister()` し、`sm-` / `serwist-` のキャッシュを削除する | 次に**ページを開いた端末**から解除される。ナビゲーションは NetworkFirst なので、オンラインならキャッシュではなく新しい HTML と JS が読まれ、解除のコードが動く | キャッシュの中身がおかしい、SW が想定外のリクエストを横取りする、など |
| 2. 自己消去する SW | 環境変数 `SW_KILL_SWITCH=true` で再デプロイする。`/serwist/sw.js` の route handler が、通常の SW の代わりに**自己消去用の SW**（`src/app/sw-kill.ts`）を配信する。この SW は `install` で即 `skipWaiting()`、`activate` で全キャッシュの削除・`registration.unregister()`・開いているウィンドウの再読み込み（`client.navigate(client.url)`）を行う | ページの JS が動かなくても、ブラウザが SW の更新を確認した時点（ナビゲーション時、または 24 時間以内）で解除される | SW の不具合でページ自体が正しく読み込めない、段階 1 が効かない場合 |

- 段階 2 のビルドは、O1 の時点で用意する。E2E（O-10）で「通常の SW → kill switch のビルドに切り替え → 登録が解除され、キャッシュが空になり、ページが通常どおり読める」ことを確認しておく
- `Clear-Site-Data: "storage"` ヘッダは使わない。IndexedDB も消えるため、未送信の変更（outbox）が失われる
- 問題が直ったら、環境変数を戻して再デプロイし、SW を再び有効にする

### 4. 同期のタイミング

| きっかけ | 動作 |
|---------|------|
| ローカルへの書き込み後 | 2 秒のデバウンスで push |
| `online` イベント | push → pull |
| アプリの起動・`visibilitychange` で前面に戻ったとき | push → pull（前回から 30 秒以上空いた場合） |
| 手動更新ボタン | push → pull |
| 定期実行 | 行わない（ADR-004 の「リアルタイム不要」に従う。電池と通信量のため） |

Background Sync API は iOS で使えないため、上記のアプリ側のきっかけで再送する。

### 5. ローカル DB の分離

- ゲストは `ShoppingMemosDB`（現行）、ログイン中は**ユーザーごとの DB `ShoppingMemosDB-u-<userId>`** を使う。ゲストのデータとサーバーの複製が混ざらず、ログアウト時は DB ごと削除するだけで済む
- 初回ログイン時の流れは、既存の `DataMergeContext`（ゲストのデータを `sync.merge` で送る）→ 成功したらゲスト DB を空にする → ユーザー DB に初回の全件 pull、とする

## 実装方針

### サーバー

**スキーマ（Drizzle マイグレーション）**

| テーブル | 追加・変更 |
|---------|-----------|
| `items`, `tags`, `shopping_lists`, `list_items` | `updated_at`（ないものに追加。書き込みのたびに `now()`）、`deleted_at`（論理削除）、`(group_id, updated_at)` と `(user_id, updated_at)` のインデックス |
| `item_tags` | 中間テーブルの削除が pull で伝わらないため、pull では item に `tagIds` を埋め込んで返す（中間テーブル自体は変更しない） |
| `sync_operations` | 冪等化のため、`id`（クライアントの操作 ID）を一意キーとして使う。処理結果（`applied` / `rejected` / `conflict`）を記録する |

- 既存の取得系クエリは、すべて `deleted_at IS NULL` で絞り込む（リポジトリ層で共通化する）
- tombstone（`deleted_at` が入った行）は 30 日後に物理削除する（定期ジョブは別 Issue。当面は削除しない）。30 日を超えてオフラインだったクライアントは、全件の再同期にする

**`sync.push`（作り直し）**

```typescript
input: {
  operations: Array<{
    opId: string            // クライアントで採番、冪等キー
    entity: "item" | "tag" | "list" | "listItem"
    entityId: string        // クライアントで採番した UUID
    type: "create" | "update" | "delete" | "finishShopping" | "revertHistory"
    patch?: Record<string, unknown>  // entity ごとの Zod スキーマで検証
    clientTime: string      // 補正済みの ISO 時刻
  }>  // 最大 100 件 / リクエスト
}
output: {
  serverTime: string
  results: Array<{ opId: string; status: "applied" | "duplicate" | "conflict" | "rejected"; reason?: string; serverRow?: unknown }>
}
```

- 操作ごとに**認可**する（自分の個人データ、または所属しているグループのデータだけ）。既存の catalog / shopping のサービス層を再利用し、tRPC の通常ミューテーションと同じ検証を通す
- 操作は 1 件ずつのトランザクションで適用し、1 件の失敗で全体を止めない。`opId` が処理済みなら `duplicate` を返す

**`sync.pull`（作り直し）**

```typescript
input: { cursor?: string }  // 不透明なカーソル（updated_at + id）
output: {
  serverTime: string
  changes: { items: Row[]; tags: Row[]; lists: Row[]; listItems: Row[] } // deleted_at を含む
  memberships: { groupIds: string[] }  // 所属グループの現在の一覧
  nextCursor: string; hasMore: boolean  // 1 回 500 行まで
}
```

- 対象は、自分の個人データと所属グループのデータ
- 所属グループの一覧が前回と変わったとき（脱退・追加）は、クライアントがそのグループのローカルデータを削除するか、カーソルなしで再取得する

**ID の受け入れ**: `createItemSchema` などの作成用スキーマに `id: z.string().uuid().optional()` を追加し、既存の tRPC ミューテーションでもクライアント ID を受け付ける。

### クライアント

**Dexie version 9**

- `lists`, `listItems` に `updatedAt` を追加する。ローカルで更新するたびに、全エンティティの `updatedAt` を補正済みの時刻で更新する（現在 `db.items.update` が `updatedAt` を更新していない問題も直す）
- `syncQueue` を拡張: `{ id(opId), entity, entityId, type, patch, clientTime, retryCount, status: "pending" | "inflight" | "failed", lastError? }`
- **キューの圧縮**: 同じエンティティへの未送信の操作をまとめる。create + update → create（パッチを統合）、update + update → update（統合）、create + delete → 両方消す、update + delete → delete
- ユーザー DB の `meta` テーブル: `cursor`, `serverTimeOffset`, `lastSyncAt`, `groupIds`

**リポジトリ層（新規 `src/infrastructure/local/`）**

- `itemRepository`, `tagRepository`, `listRepository` を作る。書き込みは `db.transaction("rw", [table, db.syncQueue], ...)` で、エンティティとキューを同時に更新する（ゲストではキューに積まない）
- 既存の hook（`src/hooks/data/*`）の書き込みは、すべてこのリポジトリ経由にする。読み取りは `useLiveQuery` に一本化し、tRPC のクエリ分岐を削除する（`useDataSource` の `useServer` は「同期を有効にするか」の意味に変える）
- グループ管理（`identity.*`）は、tRPC を直接呼ぶオンライン限定のまま残す。`groups` / `groupMembers` は、pull のたびに `identity.getGroups` の結果で上書きして読み取り専用でキャッシュする（オフラインでもグループの切り替えと表示はできる）

**SyncEngine（既存を拡張）**

- `push()`: `pending` のキューを 100 件ずつ送る → `applied` / `duplicate` は削除、`conflict` は `serverRow` をローカルに反映（トースト）、`rejected` は `failed` にする。ネットワークエラーと 5xx は指数バックオフ（2 秒〜5 分）で再試行し、401 は「セッション切れ」状態にして停止
- `pull()`: `hasMore` が false になるまでカーソルで取得 → `bulkPut` / tombstone の削除 → メンバーシップの差分を処理。**ローカルに未送信の操作があるエンティティは上書きしない**（push が先、pull が後の順番を守る）
- 同時実行の防止: 同期処理は 1 本だけにする（タブ間は Web Locks API の `navigator.locks.request("sync")`）
- `SyncProvider` を providers に組み込む（`Auth > DataMerge > Sync > Group > DB`）。`useSync()` で `isOnline`, `isSyncing`, `pendingCount`, `failedCount`, `lastSyncAt`, `sessionExpired` を公開する

**オフライン時のセッション（#61 に依存）**

- ログインに成功したら、`{ userId, name, email }` を localStorage の `lastKnownUser` に保存する
- `AuthContext` は、セッション取得がネットワークエラーで失敗し、`lastKnownUser` があれば `status: "offline"`（ユーザーあり扱い）にする。サーバーが明示的に未認証を返したとき（オンラインで 401）だけ、`unauthenticated` にする
- `navigator.onLine` は誤判定がある（キャプティブポータルなど）ため、「オンライン」は「直近の API 呼び出しが成功したか」と組み合わせて判断する

**UI**

- `src/components/sync/OfflineBanner.tsx`, `SyncStatusBadge.tsx`, `FailedOperationsSheet.tsx`, `UpdateAvailableToast.tsx`
- オンライン限定の操作には `useOnlineOnly()` フックを使い、無効化とツールチップを出す

## 影響範囲

| ファイル | 変更 |
|---------|------|
| `package.json` | `@serwist/turbopack`, `serwist`, `esbuild` を追加 |
| `next.config.ts`, `src/app/sw.ts`, `src/app/serwist/[path]/route.ts`, `src/app/~offline/page.tsx` | 新規・変更 |
| `src/app/layout.tsx`, `src/components/pwa/RegisterSW.tsx`, `public/sw.js` | SerwistProvider に置き換え、旧 SW を削除 |
| `src/app/sw-kill.ts`, `src/components/pwa/SWKillSwitch.tsx`, `src/components/pwa/UpdateAvailableToast.tsx` | 新規（kill switch、更新通知） |
| `src/app/api/trpc/[trpc]/route.ts` | `Cache-Control: private, no-store` を付与 |
| `src/app/lists/[id]/page.tsx` → `src/app/lists/detail/page.tsx` | 静的ルート化、旧ルートはリダイレクト |
| `src/app/page.tsx`, `src/app/lists/new/page.tsx` ほか | リスト詳細への遷移先 URL の変更 |
| `src/infrastructure/db/drizzle/schema.ts` + `migrations/` | `updated_at` / `deleted_at` / インデックス |
| `src/infrastructure/trpc/routers/sync.ts` | push / pull の作り直し |
| `src/infrastructure/trpc/routers/{catalog,shopping}.ts`、サービス層・リポジトリ層 | 論理削除、`deleted_at` の絞り込み、クライアント ID の受け入れ |
| `src/shared/schemas/*` | `id` の追加、push のパッチ用スキーマ |
| `src/lib/db/index.ts` | Dexie v9、ユーザーごとの DB |
| `src/infrastructure/local/*`（新規） | リポジトリ層 |
| `src/infrastructure/sync/SyncEngine.ts`, `src/contexts/SyncContext.tsx`, `src/app/providers.tsx` | push / pull の実装と組み込み |
| `src/hooks/data/*` | ローカルファースト化（tRPC の分岐を削除） |
| `src/contexts/AuthContext.tsx`, `src/contexts/DataMergeContext.tsx` | `lastKnownUser`、ログアウト時の消去、マージ後のゲスト DB 消去 |
| `src/components/sync/*`（新規） | 状態表示の UI |
| `playwright.config.ts`, `e2e/offline/*`（新規） | オフライン用のプロジェクトを追加 |
| `docs/adr/004`, `docs/adr/005`, `docs/sync-implementation-status.md` | 方針の更新（「C: 現状維持」を「A: ローカルファースト移行」に。`@serwist/next` を `@serwist/turbopack` に） |

## 本番環境への影響とリリース手順

### 本番への影響

| 項目 | 影響 |
|------|------|
| Service Worker | 本番に初めてキャッシュする SW が入る。既存の素通しの `/sw.js` は、新しい SW に置き換わる。不具合が起きたら kill switch で解除する（ロールバックでは消えない） |
| 既存の家族（ログイン中） | R3 のリリース後、初回起動時に、自分のデータの全件 pull がユーザー DB に走る（数百件程度の想定で、数秒）。それまではサーバーから直接表示しているので、端末に未送信のデータはない |
| ゲスト利用者 | R1 からオフラインで起動できるようになる。データの扱いは変わらない |
| DB | `updated_at` / `deleted_at` / インデックスの追加（列の追加のみ）。削除が論理削除になる |
| API | `sync.push` / `sync.pull` の仕様が変わる。現在の呼び出し元は `DataMergeContext`（`sync.merge`）だけで、push / pull は未使用なので、既存の端末への影響はない |
| デプロイとマイグレーションの順序 | Vercel のデプロイと CI の `migrate` ジョブ（main への push 時）は互いを待たない。そのため、**マイグレーションは必ず先に単独でリリースする**（列を足すだけで、古いコードはそのまま動く）。その後で、新しい列を使うコードをリリースする |
| Vercel Preview | develop にマージすると Preview に SW 入りでデプロイされる。Preview のドメインはデプロイごとに変わるので、SW とキャッシュもドメインごとに分かれ、本番には影響しない |

### リリース手順（develop → main）

| リリース | 含める PR | 確認すること |
|---------|----------|-------------|
| R0 | #65（Next.js の更新）、#64 / #68 / #69（認可の修正） | 既存機能の回帰（E2E 全件） |
| R1 | O1 + O1b + O2（SW とリスト詳細のルート変更） | 実機（iOS / Android）でオフライン起動、更新トースト、旧 URL のリダイレクト。**リリース後 1 週間は様子を見て**、問題がなければ R2 に進む |
| R2a | O3 のマイグレーションだけ | `migrate` ジョブの成功、既存機能に影響がないこと |
| R2b | O3 のコード + O4 + O5（サーバーの同期 API） | 既存の画面は tRPC の直接呼び出しのままなので、論理削除の挙動（削除したものが一覧に出ない）を確認する |
| R3 | O6 + O7 + O8 + O9（クライアントのローカルファースト化）。**分けずに同時にリリースする** | O7 / O8 だけを出すと、オフライン時にログイン状態が失われ、ゲストの表示に切り替わる（O9 で解消）。家族の端末で、オフラインでの追加・チェック → 復帰後の反映を確認する |
| R4 | O10（ドキュメント） | |

各リリースの共通手順:

1. develop と main の差分を確認する（`git log origin/main..origin/develop`）。対象外の未リリースのコミットがあれば、先に別のリリースとして出す
2. Preview（develop）で、上表の確認項目を手動で確認する（SW の確認は、Preview の URL を実機のホーム画面に追加して行う）
3. DB の変更を含むリリース（R2a、R2b）の前に、Neon で本番ブランチのバックアップを作る
4. develop → main の PR を作り、CI（lint / test / build / E2E）が通ることを確認してマージする
5. CI の `migrate` ジョブの成功と、Vercel の本番デプロイの完了を確認する
6. 本番で動作を確認し、家族に案内する（R1: 「圏外でも開けるようになりました」、R3: 「オフラインでも編集できるようになりました」）

### ロールバック

| リリース | 戻し方 |
|---------|-------|
| R1（SW） | **Vercel の Promote では SW が消えない**ので、kill switch の段階 1 → 必要なら段階 2 を前進デプロイする。ルート変更（O2）だけの問題なら Promote でよい |
| R2a / R2b | アプリは Promote で戻せる。ただし R2b 以降に論理削除された行は、古いコードでは一覧に再び出てくる。戻す場合は `deleted_at IS NOT NULL` の行を物理削除する SQL を流す（バックアップを取ってから） |
| R3 | アプリは Promote で戻せる（サーバーファーストの表示に戻る）。端末に残った未送信の変更は、ユーザー DB に保持されたままになり、再び R3 を出したときに送られる。SW のキャッシュが古い JS を出し続ける場合は、R1 の kill switch を併用する |

## 実装ステップ（1 ステップ = 1 PR、500 行以下目安）

| # | PR | 主な内容 | 依存 | 規模目安 |
|---|----|---------|------|---------|
| O1 | `feat: Serwist を導入しアプリシェルをオフラインキャッシュ` | `@serwist/turbopack` の導入、`sw.ts`、プリキャッシュ、`/~offline`、`/api/**` を NetworkOnly に、キャッシュのバージョン管理、kill switch（段階 1・2）、SerwistProvider と旧 `/sw.js` の削除、Playwright の `offline` プロジェクト（`next build && next start`、`serviceWorkers: "allow"`）。既存のプロジェクトには `serviceWorkers: "block"` を設定。**この時点で、ゲストはオフラインでも完全に動く** | #65（Next.js 更新） | ~450 |
| O1b | `feat: SW の更新通知と定期的な更新確認を追加` | `UpdateAvailableToast`、`SKIP_WAITING` のメッセージ、`visibilitychange` / 1 時間ごとの `registration.update()`、`controllerchange` でのリロード | O1 | ~200 |
| O2 | `refactor: リスト詳細を /lists/detail?id= の静的ルートに変更` | ルートの移動、旧 URL のリダイレクト、遷移元の修正、プリキャッシュ対象への追加、E2E の URL 修正 | O1b | ~200 |
| O3 | `feat: 同期用に updated_at / deleted_at を追加し論理削除化` | Drizzle のマイグレーション、既存の削除を論理削除に、取得クエリの絞り込み、update / delete の WHERE にスコープ（#73-1）、作成時のクライアント ID 受け入れ | #64 | ~400 |
| O4 | `feat: sync.push を実データに反映する冪等 API に作り直し` | 操作ごとの認可、パッチの検証と上限、LWW と削除優先、`opId` による冪等化、`serverTime`（#69 の push 部分を解消） | O3、#68、#69（merge 部分） | ~500 |
| O5 | `feat: sync.pull をカーソル差分取得に作り直し` | カーソル、tombstone、`tagIds` の埋め込み、メンバーシップ、ページング | O3（O4 とは独立だが、ルールに従い O4 のマージ後に着手） | ~350 |
| O6 | `feat: クライアント同期エンジン（push/pull/キュー圧縮）を実装` | Dexie v9、ユーザーごとの DB、`meta`、リポジトリ層の土台、SyncEngine の push/pull/バックオフ/ロック、SyncProvider の組み込み（この PR では hook はまだ tRPC 直呼びのまま。同期エンジンは「キューが空なら pull するだけ」で動く） | O4, O5 | ~500 |
| O7 | `refactor: カタログ（items/tags）をローカルファーストに移行` | `useItems` / `useTags` / ミューテーションをリポジトリ経由に。マージ後のゲスト DB 消去と初回の全件 pull | O6 | ~400 |
| O8 | `refactor: 買い物（lists/listItems/history）をローカルファーストに移行` | `useLists` / `useListMutations` / `useHistory*` の移行、`finishShopping` / `revertHistory` の複合操作 | O7 | ~500 |
| O9 | `feat: オフライン時のセッション保持と同期状態 UI を追加` | `lastKnownUser`、`status: "offline"`、セッション切れの処理、ログアウト時の消去と確認、OfflineBanner / SyncStatusBadge / FailedOperationsSheet / 手動更新、オンライン限定操作の無効化 | O8、#61 の A2（AuthContext の置き換え） | ~450 |
| O10 | `docs: ADR-004/005 と同期実装状況を更新` | ADR の更新、`sync-implementation-status.md` の更新 | O9 | ~150 |

- **セキュリティ Issue との順序**: #64 / #68 / #69 は既存の API の不具合で、本設計のサーバー側ステップ（O3 / O4）が同じサービス層に乗るため、**先に修正してマージする**。#65（依存更新）は O1 の前に行う
- **本番リリースの単位**は上の「リリース手順」に従う（R1 = O1〜O2、R2a / R2b = O3〜O5、R3 = O6〜O9 を同時）
- **#61 との順序**: O1〜O8 は #61 と独立に進められる。O9 だけは #61 の A2 のマージ後に着手する。どちらも `priority:high` だが、**#61（A1〜A2）を先に進め、その後に O1 から始める**ことを推奨する。認証の置き換えが先に済んでいれば、O9 で `AuthContext` を二度書き換えずに済む
- O1 は単独でも価値が大きい（ゲストのオフライン起動が直る）。O1 だけ先行してもよい

## テスト計画

### ユニット（Vitest）

| 対象 | テスト内容 |
|------|-----------|
| キューの圧縮 | create+update / update+update / create+delete / update+delete の各組み合わせ、別のエンティティは圧縮しない |
| 時刻の補正 | `serverTime` から offset を計算し、操作時刻に反映する |
| SyncEngine.push | applied/duplicate はキューから削除、conflict はローカルに上書き、rejected は failed、ネットワークエラーはバックオフ、401 は sessionExpired、100 件ごとの分割 |
| SyncEngine.pull | ページング、tombstone の削除、未送信の操作があるエンティティは上書きしない、グループ脱退時のデータ削除 |
| 同期ロック | 同時に呼んでも 1 本しか走らない |
| リポジトリ | 書き込みとキューの記録がアトミック（失敗時は両方ロールバック）、ゲストではキューに積まない、`updatedAt` の更新 |
| `sync.push`（サーバー、DB モック） | 正常系の create/update/delete、他人のデータは rejected、所属外グループは rejected、古い clientTime は conflict + serverRow、削除済みへの update は conflict、opId の重複は duplicate、パッチのバリデーションエラー |
| `sync.pull`（サーバー） | カーソル以降の差分だけ返す、deleted_at を含む、他人・所属外グループのデータを含まない、500 行でのページング |
| 論理削除 | 既存の取得系 API が削除済みの行を返さない |
| AuthContext のオフライン | ネットワークエラーかつ `lastKnownUser` あり → offline、401 → unauthenticated |
| SW の設定 | `runtimeCaching` で `/api/**`（trpc / auth / e2e / ogp）が NetworkOnly になる（matcher の単体テスト）、キャッシュ名に `CACHE_VERSION` の接頭辞が付く |
| キャッシュの掃除 | `activate` で、現在のバージョン以外の `sm-` キャッシュだけを削除し、他のキャッシュには触れない |
| kill switch | `NEXT_PUBLIC_SW_ENABLED=false` で `SWKillSwitch` が全登録の `unregister` とキャッシュ削除を呼ぶ。`SW_KILL_SWITCH=true` で route handler が自己消去用の SW を返す |
| 更新通知 | `waiting` の SW があるとトーストを出す。［更新］で `SKIP_WAITING` を送り、`controllerchange` で 1 回だけリロードする |
| UI | OfflineBanner の表示切り替え、バッジの件数、FailedOperationsSheet の破棄、オンライン限定ボタンの無効化 |

### E2E（Playwright）

オフラインのシナリオは `offline` プロジェクト（本番ビルド、chromium、`serviceWorkers: "allow"`）で実行する。SW が制御するまで待ってから（`navigator.serviceWorker.ready` の後に 1 回リロード）、`context.setOffline(true)` を使う。

| ID | シナリオ |
|----|---------|
| O-1 | （ゲスト）オンラインで 1 回開く → オフライン → リロードしてもホームが表示され、アイテムを追加できる |
| O-2 | （ゲスト）オフラインで未訪問のページ（タグ管理・履歴）に遷移できる。キャッシュにない URL は `/~offline` になる |
| O-3 | （ログイン）オフラインでアイテムを追加・編集・削除 → 未同期件数が表示される → オンライン復帰 → 件数が 0 になり、別のコンテキスト（user-b）に反映される |
| O-4 | （ログイン）オフラインでリストを作成 → 詳細を開いてチェック → 買い物完了 → 復帰後にサーバーの履歴に反映される |
| O-5 | （ログイン 2 ユーザー）同じアイテムを A がオフラインで編集し、B がオンラインで後から編集 → A が復帰すると B の値が残る（LWW） |
| O-6 | （ログイン）A がオフラインで編集中に B が削除 → A が復帰すると削除される（削除優先） |
| O-7 | （ログイン）オフライン中はグループ作成ボタンが無効 |
| O-8 | （ログイン）未送信の変更があるままログアウト → 確認ダイアログ → 破棄 → ゲストモードに戻り、ユーザーのデータが残っていない |
| O-9 | SW の更新: 新しいビルドで更新トーストが出て、［更新］でリロードされる（可能なら。難しければ手動テストにする） |
| O-10 | kill switch: 通常の SW が有効な状態 → `SW_KILL_SWITCH=true` のビルドに切り替え → 登録が解除され、`sm-` のキャッシュが空になり、ページが通常どおり読める。`NEXT_PUBLIC_SW_ENABLED=false` でも同様 |
| O-11 | `/serwist/sw.js` のレスポンスに `Service-Worker-Allowed: /` と `Cache-Control: no-cache` が付き、`/api/trpc` のレスポンスに `Cache-Control: private, no-store` が付く |
| O-12 | 既存の `/sw.js` が登録された状態から、新しい SW に置き換わる（旧 SW を登録した状態を作ってから、新しいビルドを開く） |
| 既存 | 既存の spec（`serviceWorkers: "block"`）が全件パスする（ローカルファースト化の回帰確認） |

### 手動テスト（実機）

- iOS Safari の「ホーム画面に追加」→ 機内モードで起動、追加・チェック → 機内モードを解除して反映を確認
- Android Chrome でも同じ確認

## セキュリティ

- Cache Storage にユーザー固有のデータを置かない（tRPC は NetworkOnly、HTML は全ユーザー共通のシェルだけ）。ログアウト時は念のため、ランタイムキャッシュ（pages / pages-rsc / others）を削除する
- IndexedDB のユーザー DB は、ログアウト時に削除する。**別のユーザーでログインしたとき**（`lastKnownUser.userId` と新しい userId が違う）も、前のユーザーの DB とランタイムキャッシュを削除する。ユーザーごとに DB を分けているので、削除が漏れても表示が混ざることはない
- SW がキャッシュするのは allowlist の対象だけで、`/api/**` は既定で NetworkOnly にする（`/api/auth`, `/api/trpc`, `/api/e2e`, `/api/ogp` を含む）
- `sync.push` は通常のミューテーションと同じ認可・バリデーションを通す（同期 API を権限チェックの抜け道にしない）。1 リクエストの操作数とパッチのサイズに上限を設ける
- クライアントから来る `clientTime` は、サーバー時刻より未来なら `serverTime` に丸める（未来の時刻で常に勝つ不正を防ぐ）
- SW のスクリプト（`/serwist/sw.js`）は `Cache-Control: no-cache` で配信する。#71 の CSP では `worker-src 'self'` を許可する

### セキュリティ Issue との対応

| Issue | 内容 | 本設計での扱い |
|-------|------|---------------|
| #69 | `sync.push` が他人の操作ログを返す、`sync.merge` の認可・入力検証がない | **O4 で `sync.push` を作り直して解消する**（操作ごとの認可、他人のデータは `serverRow` を返さず rejected にする）。`sync.merge` 側の修正は、O4 より**前に #69 で**行う（初回ログインのマージは本設計でも使い続けるため） |
| #64 | finishShopping / revertHistory / deleteHistory が、名前だけで全ユーザーのアイテムを更新・削除する | **O4 より前に修正が必須**。push の複合操作（`finishShopping` / `revertHistory`）は同じサービス層を再利用するため。#64 で `list_items.source_item_id` を追加する場合は、O3 のマイグレーションと競合しないよう #64 を先にマージする |
| #68 | itemId / tagId の所有権を検証していない。listItem の groupId がリスト側の値になっていない | **O4 より前に修正が必須**。push はこの検証を通るサービス層を使う。pull は `list_items.group_id` で絞り込むため、#68 の groupId 修正が pull の正しさの前提になる |
| #73-1 | リポジトリの update / delete の WHERE が id だけ | O3（論理削除化）で、update / delete の WHERE に `user_id` / `group_id` のスコープ条件を入れる |
| #72 | 配列件数・payload サイズの上限、ページングがない | push は 1 リクエスト 100 件まで、パッチは JSON で 8KB まで、pull は 1 回 500 行のページングにする（O4 / O5） |
| #71 | セキュリティヘッダがない | 上記の `worker-src` と SW スクリプトの Cache-Control |
| #65 | Next.js 16.1.5 の既知脆弱性 | O1 の前に #65 で Next.js を更新し、更新後のバージョンで `@serwist/turbopack` の動作を確認する |

## 考慮事項

- **IndexedDB の容量と退避**: Safari は、しばらく使われないサイトのストレージを削除することがある（ITP）。`navigator.storage.persist()` を要求し、削除されていたら全件 pull で復元する（サーバーが正なので、未送信の分以外は失われない）
- **未送信データの消失リスク**: ログアウトとストレージ削除の際に失われうる。前者は確認ダイアログで防ぎ、後者は「前面に戻ったら push」で未送信の時間を短くする
- **ID の衝突**: UUID v4 なので実質起きない。サーバーは主キーの衝突を、所有者が違えば rejected、同じなら更新として扱う
- **マージ（初回ログイン）との関係**: 既存の `sync.merge` と `DataMergeContext` は維持する。将来、マージを「ゲスト DB のデータを push に積み直す」形に統一できるが、本 Issue の対象外とする
- **パフォーマンス**: 読み取りを Dexie に一本化することで、画面の表示はサーバーファーストより速くなる。pull はカーソルによる差分取得なので、通信量は小さい
- **ADR の更新**: ADR-004 の「現在の実装状況：C: 現状維持」を「A: ローカルファースト移行」に、ADR-005 の `@serwist/next` を `@serwist/turbopack` に更新する（O10）
- **本番の既存データ**: O3 のマイグレーションは列の追加だけにし、既存のデータを保持する。R3 のリリース直後は、既存のログインユーザーのユーザー DB が空なので、初回の全件 pull が走る（「## 本番環境への影響とリリース手順」参照）

## ユーザーに確認したいこと

1. **ログイン中もこの端末の IndexedDB を正として動かす「ローカルファースト」方式に移行してよいですか？**（推奨。オフラインで作ったリストでそのまま買い物できる。hook の書き換えが大きく、PR は約 10 本の見込み。代替の TanStack Query 永続化は、変更量は少ないが、オフラインでの新規作成と、その後の連続操作に弱い）
2. **競合は「変更したフィールドだけ送る + 新しい操作が勝つ + 削除が優先」で自動解決し、他の端末の変更で上書きされたときはトーストで知らせるだけ、でよいですか？**（どちらを残すか選ばせる UI は作らない）
3. **リスト詳細の URL を `/lists/<id>` から `/lists/detail?id=<id>` に変更してよいですか？**（オフラインで作ったリストを開くために必要。旧 URL はリダイレクトで残す）
4. **グループの作成・参加・メンバー管理・招待コードの再生成は「オンライン時のみ」でよいですか？**（アイテム・タグ・リスト・履歴はオフラインで可能）
5. **同期はイベント駆動（書き込み後・オンライン復帰時・アプリを前面に戻したとき・手動更新）だけでよいですか？ 定期的な自動取得（例: 60 秒ごと）は必要ですか？**（推奨は定期取得なし）
6. **#61（認証の変更）を先に進め、その後で本 Issue に着手する順番でよいですか？**（O1 の SW キャッシュだけは、ゲストのオフライン起動が直るので先行してもよい）
