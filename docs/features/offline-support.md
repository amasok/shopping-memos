# オフライン対応（ログイン中の編集と復帰時の同期、Service Worker キャッシュ）

> ステータス: **方針承認済み（2026-11-16）・実装中**（O1〜O2 は実装済み〈R1〉。O3〜O5 のサーバー側を実装中。決定事項 6 の補足を参照）
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

前提は ADR-004 と同じ（主に夫婦 2 人、同時編集はまれ、リアルタイム性は不要）。ただし「店内でオフラインのままチェック → その間に家族が家でメモを編集」は**主な使い方そのもの**なので、別々のフィールドの編集が両方残ることを必須とする。

| 案 | 評価 |
|----|------|
| **パッチ送信 + フィールド単位の LWW + 削除優先（推奨・決定）** | 更新操作は**変更したフィールドだけ**を、フィールドごとの操作時刻つきで送る（例: `{checked: true}` と `{checked: t1}`）。サーバーは行ごとに `field_modified_at`（フィールド → 最後に適用した操作時刻）を持ち、**フィールドごとに**「操作時刻 ≧ そのフィールドの時刻」なら適用し、古いフィールドだけを捨てる。削除は常に勝つ（tombstone） |
| パッチ送信 + レコード単位の LWW | 実装は少し簡単。ただし、上の例でオフラインのチェック（t1）が、家族の後からのメモ編集（t2 > t1）に負けて**チェックが消える**。不採用 |
| サーバーの受信順 LWW | 最も簡単。ただし長時間オフラインだった端末の古い編集が、新しい編集を上書きしてしまう |
| バージョン番号で競合を検出 → ユーザーに選ばせる | 確実だが、UI と実装が重い。買い物メモには過剰 |
| CRDT（Yjs / Automerge） | 過剰。サーバーの DB 設計とも合わない |

**2 種類の時刻を分ける**

| 列 | 中身 | 用途 |
|----|------|------|
| `updated_at` | **サーバーの書き込み時刻**（`now()`。どの操作を適用したときも更新） | pull のカーソル専用。LWW の判定には使わない |
| `field_modified_at`（jsonb） | フィールド名 → そのフィールドに最後に適用した**操作時刻**（クライアント時刻をサーバー時刻で補正したもの） | LWW の判定専用。**キーがないフィールドは「最も古い時刻」として扱い、届いた操作を常に適用する**（O3 のマイグレーション前からある行や、まだ一度も更新されていないフィールド）。O3b 以降は、通常の tRPC の mutation でも、書き込んだフィールドのキーをサーバー時刻で更新するので、キーがないまま新しい値で上書きされることはない |

- `updated_at = now()` を LWW に使うと、古い操作を適用した時点で `updated_at` が「現在」になり、その後に届いた本当は新しい操作が却下される。逆に `updated_at` に操作時刻を入れると、pull のカーソルが過去の時刻で書かれた行を取りこぼす。そのため 2 つを分ける

補足ルール:

- **時刻の補正**: push / pull のレスポンスで `serverTime` を返し、クライアントは `offset = serverTime − 受信時刻` を保持する。操作時刻は `Date.now() + offset` で記録する（端末の時計ずれ対策）。サーバーは、未来の操作時刻を `serverTime` に丸める
- **作成**: クライアントの UUID で冪等な upsert にする。全フィールドの `field_modified_at` に作成時刻を入れる。同じ ID がすでにあれば、フィールド単位の更新として扱う
- **削除**: `deleted_at` を入れた行（tombstone）には、以降の update を適用しない（結果は `conflict`。クライアントはローカルの行を消す）。削除 vs 編集は削除が勝つ（ADR-004 どおり）
- **同名アイテムの作成**: 両方残す（ADR-004 どおり）
- **`listItems.checked`**: 単独のフィールドとして LWW にする（チェックとメモ・数量の編集が互いに消し合わない）
- **買い物完了（finishShopping）/ 履歴の取り消し（revertHistory）**: リストの状態とアイテムの購入日時をまとめて変える複合操作。1 つの操作として送り、サーバーは 1 トランザクションで適用する。対象のフィールドの時刻は、その操作の時刻で更新する

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
- **既存の `/sw.js` からの移行**: 本番の利用者の端末には、今の素通しの `/sw.js` がスコープ `/` で登録されている。新しい SW を同じスコープ `/` で登録すると、同じ登録のスクリプトが置き換わる。新しいページをまだ読み込んでいない端末も確実に掃除するため、`public/sw.js` は削除せず、**自分の登録を解除する SW** に書き換えて残す（キャッシュを消し、`registration.unregister()` するだけ）。R3 の安定を確認したら O11 で削除する
- **新旧クライアントの混在**: 更新は利用者任意なので、古いシェルのまま新しい API を呼ぶ端末が残る。オフラインだった端末は、古いコードのまま数日後に push してくることもある。そこで次のようにする
  - `sync.push` / `sync.pull` の入力に `protocolVersion` を含める。サーバーは**現在と 1 つ前のバージョンを、少なくとも 30 日間**受け付ける
  - 対応外のバージョンなら `CLIENT_TOO_OLD` エラーを返す。未送信の操作はキューに残したまま、強制更新（下記）に進む
- **強制更新（最低バージョン）**: 重大な不具合や API の非互換のときに、利用者の選択を待たずに更新させる
  - ビルドごとに `NEXT_PUBLIC_APP_VERSION`（コミット SHA）と `NEXT_PUBLIC_BUILD_TIME`（`next.config.ts` でビルド時の `Date.now()` を埋め込む）を持たせる。**リリース番号にはビルド時刻を使う**（Vercel のビルドは shallow clone なので、`git rev-list --count` でのコミット数は使えない。ビルド時刻なら、新しいデプロイほど必ず大きい）
  - `MIN_CLIENT_RELEASE` には、強制したいビルドの `NEXT_PUBLIC_BUILD_TIME`（デプロイのログか `/api/version` の `buildTime` で確認できる）を設定する。Promote で古いデプロイに戻した場合、そのビルド時刻は小さいので、`MIN_CLIENT_RELEASE` も合わせて下げる。設定ミスでアプリが使えなくなるのを防ぐため、クライアントは `minClientRelease` が `/api/version` の `buildTime`（サーバー自身のビルド）より大きい場合は無視する
  - サーバーは `GET /api/version` で `{ buildTime, minClientRelease }`（`minClientRelease` は環境変数 `MIN_CLIENT_RELEASE`）を返す（NetworkOnly）
  - クライアントは起動時と前面に戻ったときに確認する。自分の `NEXT_PUBLIC_BUILD_TIME` が `minClientRelease` を下回っていれば、閉じられないモーダル「アプリを更新します」を出し、`registration.update()` → `SKIP_WAITING` → リロードを自動で行う。未送信の操作は IndexedDB に残るので、更新後に送られる
  - SW 自体が壊れていて新しい JS が届かない場合は、kill switch（下記）を使う

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

- **`skipWaiting` との関係（O1b で対応）**: プリキャッシュした URL（`/` など）は、runtimeCaching の NetworkFirst より前にプリキャッシュのルートが返す（cache-first）。段階 1 の `SWKillSwitch` を含む新しい HTML が届くのは、新しい SW が有効になってプリキャッシュが入れ替わった後になる。O1 は `skipWaiting: true` なので問題ないが、O1b で更新を利用者任意（`waiting` で止める）にすると、段階 1 が効かなくなる。**kill switch を有効にしたビルド（および `MIN_CLIENT_RELEASE` を下回るとき）だけは、利用者の操作を待たずに自動で `skipWaiting` する**。ナビゲーションが NetworkFirst でも、プリキャッシュ済みの URL は SW が入れ替わるまで古い HTML が返る点に注意する
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

### 4b. ゲストのデータとログイン・ログアウト（2026-11-17 決定、#144 で改訂）

R1 の時点（ゲスト用の `ShoppingMemosDB` だけがある）での振る舞い。5 の DB の分離（O7）を入れるときも、この振る舞いを保つ。

| 場面 | 振る舞い |
|------|----------|
| ログイン | **ログインのたびに**、送る対象があれば `sync.merge` で送る。送る対象は「まだどのアカウントにも送っていないゲストのデータ（通常のテーブル）」と「**このアカウント**の merge で取り込めずに残したデータ（`pendingMerge` テーブルの、このアカウントの分）」。別のアカウントの分は送らない。初期タグ（食品・日用品・エンタメ）だけのときは送らない |
| merge の後 | **取り込めた分と取り込み済みの分は、ゲストの DB から消す。取り込めなかったものだけを、このアカウントの分として `pendingMerge` テーブルに移す**（利用者のデータを黙って失わない） |
| 残したものを見せない | `pendingMerge` のレコードは、ゲストの画面（ホーム・リスト・履歴・タグの一覧と件数・検索）には出さない。通常のテーブルから移すので、どの画面の読み出しにも現れない。同じ端末のゲスト（家族の別の人）に、A のデータが見えないようにする |
| 残したものの再送 | 同じアカウントで次にログインしたときに、もう一度送る。取り込み済みになっていれば「取り込み済み」になるだけで重複しない |
| 取り込めなかった通知 | ログイン後の通知（「n 件のデータは取り込めませんでした」）に「**破棄する**」を付ける。押したら、そのアカウントの `pendingMerge` のレコードを消す（何度送っても取り込めないものを、利用者が消せるように。ゲストの画面には出さないため、ほかに消す方法がない）。「閉じる」は通知だけを閉じ、次のログインでまた送る |
| 同じログインの間 | 再読み込みしても merge しない（`data-merge-completed-<userId>` は「このログインの間は merge 済み」の印。ゲストに戻ったら消す） |
| タグ | 同じ名前の自分の個人タグがあれば、新しく作らずにそれにまとめる。ID が別のユーザーのタグと重なったタグは、新しい ID で作る。どちらも `idMappings` で付け替えを返し、クライアントは分割送信の後のリクエストの `tagIds` を付け替える。**`pendingMerge` に移したアイテム・リストアイテムが参照しているタグも、同じアカウントの分として `pendingMerge` に入れる**（再送のときにタグの参照が切れないように。通常のテーブルに残すと、タグの名前がほかのゲストに見える） |
| ログアウト | 初期タグだけのゲストに戻る（残したデータは `pendingMerge` にあり、見えない）。ログイン中だけの状態（merge 済みの印・`selectedGroupId`）を消す |
| セッション切れ | ログアウトと同じく、ゲストに戻った時点でログイン中だけの状態を消す |

#### 取り込めなかったレコードの特定（#144）

- `sync.merge` は、取り込めなかったレコードを `notImported: NotImportedRecordRef[]` で返す
  - `type NotImportedRecordRef = { entity: "tag" | "item" | "list" | "listItem" | "history"; requestIndex: number }`
  - `requestIndex` は、**そのリクエスト（分割送信の 1 チャンク）の `data[entity]` の配列での位置**（0 始まり）。全体での位置ではない。クライアントは、チャンクごとに、送った配列と突き合わせる
  - ID ではなく位置で返すのは、形式が不正で ID が読めないレコード（検証でスキップしたもの）も特定するため
- 対象は、検証でスキップしたもの（`parseMergeData`）と、レコード単位で失敗したもの（`failedCount` に数えるもの）。タグの関連付けだけのスキップと、取り込み済みは含めない（`notImportedCount === notImported.length`）。`notImportedCount` は互換のために残す
- 履歴（`history`）は、リストの `purchasedAt` の更新なので、履歴が失敗したら、そのリストを `pendingMerge` に移す（次の再送で、リストは取り込み済み、履歴だけがもう一度当たる）

#### クライアントの処理（#144）

- `pendingMerge` テーブル（Dexie の v9 で追加）: `{ key: "<userId>:<entity>:<id>", entity, userId, record, createdAt }`。`userId` にインデックスを付ける（キーにアカウントを含め、同じレコードがアカウントごとに別に残せるようにする）
- ログイン時: 通常のテーブル（全部）と、`pendingMerge` のこのアカウントの分を合わせて送る。送るときは、`pendingMerge` の `record` を元のエンティティとして扱う
- 全チャンクが終わったら、1 つのトランザクションで次を行う
  1. 送ったレコードのうち、取り込めなかったもの（と、それらが参照するタグ）を、このアカウントの分として `pendingMerge` に入れる（すでにあれば上書き）
  2. 送ったほかのレコードを、通常のテーブルと `pendingMerge` から消す
  3. 通常のタグのテーブルが空になったら、初期タグを作り直す
- merge が例外で止まったとき（ネットワークなど）は、これまでどおり何も消さない
- 「破棄する」: `pendingMerge` から、そのアカウントの分を消す

#### 考慮事項

- 別のアカウントの分を残したまま、別のアカウントでログインして merge すると、そのアカウントの分は送らないので、`pendingMerge` に残り続ける（そのアカウントで再ログインするまで）

#### ゲストのデータを消す範囲（#144）

| 場面 | 消すもの |
|------|----------|
| merge の後 | 送ったレコードだけ（通常のテーブルと、このアカウントの `pendingMerge`）。**ほかのアカウントの `pendingMerge` は残す**。通常のタグのテーブルが空になったら、初期タグを作り直す |
| 以前の仕組みからの移行 | 全テーブル（`pendingMerge` を含む）。`clearGuestData()` の既定 |
| ログアウト・セッション切れ | ゲストのデータには触れない（ログイン中だけの状態だけを消す）。`pendingMerge` は残る |
| 「破棄する」 | このアカウントの `pendingMerge` だけ |

- **以前の仕組みからの移行（一度だけ）**: 以前の意味の merge 済みの印（`data-merge-completed-<userId>`）が残っている端末では、ゲストのデータを送らずに一度だけ空にし、初期タグだけに戻す。新しい仕組みのまま送ると、サーバーで消したアイテムやリストがまとめて戻ってしまうため（本番の利用者は 1 家族でログインして使っており、送られずに残っていたゲストのデータを失う害より、消したデータが戻る害のほうが大きいと判断した）。移行が済んだ端末には `guest-data-version = "2"` を付け、以後は新しい意味の印と取り違えない。移行は、merge の判定・ゲストに戻ったときの印の削除・ログアウトの前に行う（`ensureGuestDataMigrated`）
- ゲストのオフライン（R1）には影響しない。ゲストのデータを消すのは、オンラインで merge が成功したときだけ

### 5. ローカル DB の分離

- ゲストは `ShoppingMemosDB`（現行）、ログイン中は**ユーザーごとの DB `ShoppingMemosDB-u-<userId>`** を使う。ゲストのデータとサーバーの複製が混ざらず、ログアウト時は DB ごと削除するだけで済む
- 初回ログイン時の流れは、既存の `DataMergeContext`（ゲストのデータを `sync.merge` で送る）→ 成功したらゲスト DB を空にする → ユーザー DB に初回の全件 pull、とする

## 実装方針

### サーバー

**スキーマ（Drizzle マイグレーション）**

| テーブル | 追加・変更 |
|---------|-----------|
| `items`, `tags`, `shopping_lists`, `list_items` | `updated_at`（ないものに追加。**サーバーの書き込み時刻**で、カーソル専用）、`field_modified_at jsonb NOT NULL DEFAULT '{}'`（LWW 専用）、`deleted_at`（論理削除）、`(group_id, updated_at)` と `(user_id, updated_at)` のインデックス |
| `item_tags` | 中間テーブルの削除が pull で伝わらないため、pull では item に `tagIds` を埋め込んで返す（中間テーブル自体は変更しない） |
| `sync_operations` | 冪等化のため、`id`（クライアントの操作 ID）を一意キーとして使う。処理結果（`applied` / `rejected` / `conflict`）を記録する |

- 既存の取得系クエリは、すべて `deleted_at IS NULL` で絞り込む（リポジトリ層で共通化する）
- `updated_at` は、サーバーの DB の `now()` だけで入れる。JS の `new Date()` と混ぜない（列はタイムゾーンなしの `timestamp` で、接続のタイムゾーンは UTC 前提。アプリの時計と DB の時計がずれると、pull のカーソルが行を取りこぼす）
- **論理削除の細部（O3b で決定）**:
  - アイテムの削除は論理削除にし、`item_tags` の行は物理削除する（tombstone にタグは要らない。タグの使用数にも数えない）
  - タグの削除は論理削除にし、そのタグの `item_tags` の行を物理削除する。関連を外したアイテムは `updated_at` と `field_modified_at.tagIds` を更新する（中間テーブルの削除は pull で伝わらないので、アイテムの変更として伝える）
  - リストの削除は、リストとその `list_items` をまとめて論理削除する（物理削除の cascade の代わり）。リストからアイテムを外す操作と、買い物の完了で未チェックの行を消す処理も論理削除にする
  - 削除済みの行は、取得・一覧・件数・名前での検索や重複の確認・アクセス判定のすべてで「見つからない」扱いにする（既存の API の応答は変わらない）。削除したものと同じ名前では作り直せる。例外は ID の重なりの判定（ゲストのデータの取り込みで、その ID の行がすでにあるか）だけで、削除済みも含めて見る（取り込み後にサーバーで削除したものを、送り直しで復活させないため）
  - 削除済みの行の ID で作成すると、ID の重複（CONFLICT）として扱う。自分の行・他人の行・削除済みの行を区別せず、同じエラー・同じメッセージにする（存在の有無を漏らさない）
  - 履歴（購入済みのリスト）のアイテムはスナップショットなので、カタログのアイテムを削除しても残る。タグを削除すると、履歴のアイテムのタグの表示から消える（どちらも物理削除のときと同じ）
- **通常の mutation での同期用の列（O3b）**: `field_modified_at` のキーは API のフィールド名（`name` / `quantity` / `memo` / `tagIds` / `purchasedAt` / `checked` / `status` / `completedAt` / `location`）。値は DB の `now()` を UTC・ミリ秒の ISO 文字列（`2026-11-17T05:00:00.000Z`）にしたもので、作成時は書き込んだすべてのフィールドに、更新時は書き込んだフィールドだけに入れる（`src/infrastructure/db/syncColumns.ts`）
- **更新・削除の WHERE のスコープ（#73-1。O3b）**: リポジトリの更新・削除には操作したユーザーを渡し、WHERE に「自分の個人データ、または所属しているグループのデータ」と `deleted_at IS NULL` を付ける。`list_items` は親のリストで判定する（`list_items.user_id` は入っていないことがあるため）。一致する行がなければ `RowNotFoundError` を投げ、tRPC では NOT_FOUND にする（存在しない・削除済み・スコープ外を区別しない）
- **作成時のクライアント ID（O3b）**: `createItem` / `createTag` / `createList` / `addItemToList` / `addNewItemToList`（リストのアイテムの ID。同時に作るカタログのアイテムの ID はサーバーで採番する）で、任意の uuid の `id` を受け付ける。使用済みの ID は CONFLICT にする
- tombstone（`deleted_at` が入った行）は 30 日後に物理削除する（定期ジョブは別 Issue。当面は削除しない）。30 日を超えてオフラインだったクライアントは、全件の再同期にする

**`sync.push`（作り直し）**

```typescript
input: {
  operations: Array<{
    opId: string            // クライアントで採番、冪等キー
    entity: "item" | "tag" | "list" | "listItem"
    entityId: string        // クライアントで採番した UUID
    type: "create" | "update" | "delete" | "finishShopping" | "revertHistory"
    patch?: Record<string, unknown>      // entity ごとの Zod スキーマで検証（JSON で 16KB まで。REQUEST_LIMITS.recordBytes）
    fieldTimes?: Record<string, string>  // patch の各フィールドの操作時刻（補正済み ISO）
    clientTime: string                   // 操作全体の時刻（create / delete / 複合操作で使う）
  }>  // 最大 100 件 / リクエスト
  protocolVersion: number
}
output: {
  serverTime: string
  results: Array<{
    opId: string
    status: "applied" | "partial" | "duplicate" | "conflict" | "rejected"
    // partial: 一部のフィールドが新しい値に負けて捨てられた。serverRow で最新の行を返す
    reason?: string
    serverRow?: unknown  // 呼び出し元がアクセスできる行に限る（#69）
  }>
}
```

- 操作ごとに**認可**する（自分の個人データ、または所属しているグループのデータだけ）。既存の catalog / shopping のサービス層を再利用し、tRPC の通常ミューテーションと同じ検証を通す
- 操作は 1 件ずつのトランザクションで適用し、1 件の失敗で全体を止めない。`opId` が処理済みなら `duplicate` を返す
- update の適用: 行を `SELECT ... FOR UPDATE` で取り、`fieldTimes[f] >= field_modified_at[f]` のフィールドだけを書き込み、`field_modified_at` を更新する。`updated_at` は `now()` にする
- **O4 での細部（2026-11-17）**（`src/modules/sync/application/services/SyncPushService.ts`）:
  - 冪等化: `sync_operations.id` を `opId` にし、操作の記録（`INSERT ... ON CONFLICT DO NOTHING`）を適用と同じトランザクションの最初に行う。同じユーザーの `opId` は `duplicate`、ほかのユーザーの `opId` と重なれば `rejected`（`op_conflict`）。処理の結果は `payload` の JSON（`{ patch, fieldTimes, clientTime, status, reason }`）に入れる（列は足さない。件数は `payload::jsonb->>'status'` で数える）
  - 結果: create は新しい行なら `applied`。同じ ID の行が使えるならフィールド単位の更新、削除済みなら `conflict`（`serverRow` に tombstone）、使えなければ `rejected`（`id_conflict`）。update は行がない・使えないなら `rejected`（`not_found`。区別しない）、削除済みなら `conflict`、捨てたフィールドがあれば `partial`（`serverRow` に最新の行。アイテムは `tagIds` つき）。delete は時刻に関係なく論理削除し、削除済みなら `applied`、行がない・使えないなら `rejected`（`not_found`）
  - パッチは、エンティティと種類ごとの strict な Zod スキーマで検証する（未知のフィールドは拒否）。受け付けるフィールドは tRPC と同じ範囲（update: アイテムは `name` / `quantity` / `memo` / `tagIds` / `purchasedAt`、タグとリストは `name`、リストのアイテムは `checked`）。不正ならその操作だけ `rejected`（`invalid_patch`）。パッチの大きさ（`REQUEST_LIMITS.recordBytes`）と件数（100）は入力の検証で拒否する（#72。クライアントはキューに積むときに同じ上限で検証する）
  - 認可と参照: グループへの作成はメンバーだけ（`forbidden`）。タグは同じスコープのものだけ（`invalid_reference`）。リストのアイテムは、使える進行中のリストにだけ作り、`group_id` はリストの値にする（#68）。完了したリストのアイテムの作成・チェック・削除は `rejected`（`list_completed`。tRPC と同じ）
  - 時刻: フィールドの時刻は `fieldTimes[f]`、なければ `clientTime`。`serverTime`（DB の `now()`）より未来なら `serverTime` に丸め、UTC・ミリ秒の ISO で保存する。create は、書き込んだすべてのフィールドに操作の時刻を入れる
  - 再送: `duplicate` の `reason` に、最初に処理したときの結果（`applied` / `partial` / `conflict:deleted` / `rejected:not_found` など）を入れる。クライアント（O6）は、`reason` が `applied` ならキューから消し、`partial` / `conflict` ならキューから消して pull で最新の行を取り直し、`rejected` なら `failed` にする（レスポンスが失われて再送したとき、拒否された操作を適用済みと取り違えない）
  - リストのアイテム: 作成・チェック・削除の間は、親のリストに共有ロック（`FOR SHARE`）を取り（ロックはリストの削除・完了と同じく「親のリスト → リストのアイテム」の順に取る。逆だとデッドロックになる）、リストの削除・完了と同時に走っても、削除済み・完了済みのリストの下に生きたアイテムができないようにする。親のリストが削除済みのアイテムは、削除済みと同じに扱う（update は `conflict`、delete は `applied`）
  - リポジトリの「対象なし」（`RowNotFoundError`）は、その操作だけ `rejected`（`not_found`）にする（決まって失敗する操作で、キュー全体を止めない）
  - `purchasedAt` の値も、未来なら `serverTime` に丸める。返す `serverTime` は処理の後の時刻（丸めにはリクエストの開始時刻を使う）。`fieldTimes` のキーは 20 個まで
  - 予期しないエラー（DB の障害など）は、リクエスト全体を 500 にする（クライアントがまとめて再送する。適用済みの操作は `duplicate` になる）。1 操作 1 トランザクションで、`statement_timeout` は 30 秒
  - 対応外の `protocolVersion` は `PRECONDITION_FAILED`（メッセージ `CLIENT_TOO_OLD`）。今は 1 だけを受け付ける
  - **複合操作（O4b）**: `finishShopping` / `revertHistory` は `entity: "list"` で送り、パッチは tRPC と同じ（`finishShopping` は `{ location? }`、`revertHistory` は `{}`）。1 トランザクションで、時刻はすべて操作の時刻（`clientTime` を丸めたもの）にする
    - `finishShopping`: チェック済みのリストのアイテムと同名の、リストと同じスコープのカタログのアイテムを購入済みにし（`purchasedAt` も操作の時刻）、未チェックの行を論理削除し、リストを完了にする（`status` / `completedAt` / `purchasedAt` / `location` の時刻は操作の時刻）
    - `revertHistory`: リストのアイテムと同名の、購入済みのカタログのアイテムを未購入に戻し、リストを進行中に戻す
    - カタログのアイテムは、`purchasedAt` の時刻が操作の時刻より新しいものを変えない（フィールド単位の LWW。オフラインで完了した後に、別の端末で「未購入」に戻したものを、遅れて届いた完了で上書きしない）
    - リストの状態のフィールドが操作の時刻より新しく書き換えられていれば、何もせず `conflict`（`stale`）。完了済みのリストの完了は `conflict`（`already_completed`）、完了していないリストの取り消しは `conflict`（`not_completed`）。どれも `serverRow` に最新のリストを返す。リスト以外・不正なパッチは `rejected`（`invalid_patch`）、使えないリストは `rejected`（`not_found`）、削除済みのリストは `conflict`（`deleted`）

**`sync.pull`（作り直し）**

```typescript
input: { cursor?: string; protocolVersion: number }  // 不透明なカーソル（updated_at + id）
output: {
  serverTime: string
  changes: { items: Row[]; tags: Row[]; lists: Row[]; listItems: Row[] } // deleted_at を含む
  memberships: { groupIds: string[] }  // 所属グループの現在の一覧
  nextCursor: string; hasMore: boolean  // 1 回 500 行まで
}
```

- 対象は、自分の個人データと所属グループのデータ
- **取りこぼし対策**: Postgres の `now()` は**トランザクションの開始時刻**なので、時刻順とコミット順がずれることがある（長いトランザクションほど大きくずれる）。そのため、カーソルの時刻から **60 秒さかのぼって**取り直す（`updated_at > cursor.time - 60s`）。重複して届いた行は、クライアントが冪等に適用する（同じ行を `bulkPut` するだけ）。**60 秒のさかのぼりは pull の始め（1 ページ目）だけにし、2 ページ目からは `(updated_at, id) > (t, id)` で続きを取る**（ページごとにさかのぼると、60 秒以内に 500 行を超える変更があったとき、同じページを繰り返し取り続ける）。同期の書き込みは 1 操作 1 トランザクションにし、ステートメントタイムアウトを 30 秒にして、60 秒を超えるトランザクションが起きないようにする
- **O3b からの申し送り**: タグを削除しても、リストのアイテムの `tag_ids`（スナップショット）は残り、`updated_at` も変わらない。また、リストへのアイテムの追加とリストの削除が同時に走ると、削除済みのリストの下に生きたリストのアイテムができうる。pull では、親のリストが削除済みのリストのアイテムを除くか tombstone として返し、クライアントでは、削除済みのリストのアイテムをまとめて消し、存在しないタグの ID は表示で無視する
- 所属グループの一覧が前回と変わったとき（脱退・追加）は、クライアントがそのグループのローカルデータを削除するか、カーソルなしで再取得する
- **O5 での細部（2026-11-17）**（`src/modules/sync/application/services/SyncPullService.ts`）:
  - カーソルは、エンティティ（tags / items / lists / listItems）ごとの `(updated_at, id)` と「この pull の最初のページを取ったか」を JSON にして base64url にしたもの（不透明。長さは `REQUEST_LIMITS.pullCursor` まで。形が壊れていれば BAD_REQUEST）。`updated_at` は DB の文字列のままマイクロ秒まで持つ（JS の Date にするとミリ秒に丸まり、境目の行を取りこぼす・取り続ける）
  - 1 回の pull で、tags → items → lists → listItems の順に合わせて 500 行まで返す。ページが埋まって取れなかったエンティティは、次のページで（60 秒さかのぼる）最初のページとして取る。`hasMore` が false になったら、次の pull はすべてのエンティティで 60 秒さかのぼって始める
  - 対象は `accessibleByUser`（自分の個人データか所属グループのデータ）。リストのアイテムは親のリストで判定する（`list_items.user_id` は入っていないことがある）。tombstone も返し、親のリストが削除済みのリストのアイテムは、`deletedAt` に親の削除時刻を入れて tombstone として返す。アイテムには `tagIds` を埋め込む
  - 読み取りは 1 トランザクション（`statement_timeout` 30 秒）。`memberships.groupIds` は毎ページ返す。グループの削除では、アイテムなどの `group_id` が FK の `SET NULL` で変わるが `updated_at` は変わらないので、クライアントは所属グループの一覧が変わったら、カーソルなしで取り直す（そのグループのローカルデータの削除だけでは、作成者の個人データに変わった行を取りこぼす）
  - tombstone の 30 日後の物理削除（別 Issue）を入れるときに、30 日より古いカーソルを「全件の取り直しが必要」として返すようにする（今は物理削除しないので不要）

**ID の受け入れ**: `createItemSchema` などの作成用スキーマに `id: z.string().uuid().optional()` を追加し、既存の tRPC ミューテーションでもクライアント ID を受け付ける。

### クライアント

**Dexie version 9**

- `lists`, `listItems` に `updatedAt` を追加する。ローカルで更新するたびに、全エンティティの `updatedAt` を補正済みの時刻で更新する（現在 `db.items.update` が `updatedAt` を更新していない問題も直す）
- `syncQueue` を拡張: `{ id(opId), entity, entityId, type, patch, fieldTimes, clientTime, retryCount, status: "pending" | "inflight" | "failed", lastError? }`
- **キューの圧縮**: 同じエンティティへの `pending` の操作をまとめる
  - create + update → create（パッチを統合）、update + update → update（統合）、create + delete → 両方消す、update + delete → delete
  - パッチを統合するとき、`fieldTimes` は**フィールドごとに新しい方**を残す（操作全体の `clientTime` は最新のものにする）
  - **`inflight`（送信中）の操作は圧縮の対象から外す**。例えば create を送信中に delete が来た場合、両方消すとサーバーには作成だけが残る。そのため、delete は新しい操作として積む
- **Dexie のバージョン更新（v8 → v9）**: 古いタブが開いていると `blocked` になる。古いタブ側は `versionchange` を受けたら DB を閉じてリロードする。新しいタブ側は `blocked` のときに「他のタブを閉じてください」と表示する
- ユーザー DB の `meta` テーブル: `cursor`, `serverTimeOffset`, `lastSyncAt`, `groupIds`

**リポジトリ層（新規 `src/infrastructure/local/`）**

- `itemRepository`, `tagRepository`, `listRepository` を作る。書き込みは `db.transaction("rw", [table, db.syncQueue], ...)` で、エンティティとキューを同時に更新する（ゲストではキューに積まない）
- 既存の hook（`src/hooks/data/*`）の書き込みは、すべてこのリポジトリ経由にする。読み取りは `useLiveQuery` を使う
- **フィーチャーフラグ `NEXT_PUBLIC_LOCAL_FIRST`**（本番で切り戻すための安全策）
  - `true`（R3 以降の既定）: ログイン中もローカルファーストで動く
  - `false`: 従来のサーバーファースト（tRPC 直呼び）に戻す。このとき SyncEngine は **push だけを続けて未送信のキューを送り切る**（drain モード）。端末内の未送信の変更を失わずに戻せる
  - そのため、O7 / O8 では tRPC の分岐を**すぐには消さず**、フラグで切り替えられる形で残す。R3 から 2 週間安定したら、O11 でサーバーファーストの分岐とフラグを削除する
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
| API | `sync.push` / `sync.pull` の仕様が変わる。現在の呼び出し元は `DataMergeContext`（`sync.merge`）だけで、push / pull は未使用なので、既存の端末への影響はない。R3 以降の変更は `protocolVersion` で後方互換を 30 日間保つ |
| デプロイとマイグレーションの順序 | Vercel のデプロイと CI の `migrate` ジョブ（main への push 時）は互いを待たない。そのため、**マイグレーションは必ず先に単独でリリースする**（列を足すだけで、古いコードはそのまま動く）。その後で、新しい列を使うコードをリリースする。ただし R2a のコードも、`schema.ts` に列を足すので、新しい列を select / returning で参照する（Vercel が先に終わると、migrate が終わるまで items / tags / lists / list_items の読み書きが「column does not exist」で失敗する）。そのため、**DB の変更を含むリリースは、本番 DB への migrate をアプリのデプロイより先に当てる**（expand なので古いコードはそのまま動く）。その仕組みは別の PR（別 Issue）で用意する |
| Vercel Preview | develop にマージすると Preview に SW 入りでデプロイされる。Preview は本番と別のドメイン・別の DB なので、SW・キャッシュ・データは本番に影響しない。ユーザーの確認には develop ブランチの固定 URL を使う |

### リリース手順（develop → main）

**本番（main）へは、develop の内容をユーザーが Vercel Preview で確認し、OK を出してからマージする。**

```
develop に PR をマージ
  → Vercel が Preview に自動デプロイ ＋ CI が Preview の DB にマイグレーション（#61 の A2 で追加するジョブ）
  → ユーザーが Preview で「確認チェックリスト」を実施（実機を含む）
  → OK → develop → main の PR をマージ → 本番デプロイ ＋ 本番 DB にマイグレーション
  → NG → develop で修正して、Preview の確認からやり直す
```

| リリース | 含める PR | 内容 |
|---------|----------|------|
| R0 | #65（Next.js の更新）、#64 / #68 / #69（認可の修正） | 本機能の前提になる修正 |
| R1 | O1 + O1b + O2（SW、更新通知・強制更新、リスト詳細のルート変更） | **リリース後 1 週間は様子を見て**、問題がなければ R2 に進む |
| R2a | O3（expand マイグレーションだけ） | 列を足すだけ。古いコードはそのまま動く |
| R2b | O3b + O4 + O5（論理削除、サーバーの同期 API） | 画面は tRPC の直接呼び出しのまま |
| R3 | O6 + O7 + O8 + O9（クライアントのローカルファースト化）。**分けずに同時にリリースする** | O7 / O8 だけを出すと、オフライン時にログイン状態が失われ、ゲストの表示に切り替わる（O9 で解消） |
| R4 | O10 + O11（ドキュメント、移行用コードの削除） | R3 から 2 週間安定したあと。O11 の後は、フラグによる切り戻しができなくなる |

#### Preview での確認チェックリスト（ユーザーが実施）

- Preview の URL は、develop ブランチの固定 URL（`shopping-memos-git-develop-<team>.vercel.app`）を使う。デプロイごとの URL だと、SW とホーム画面のアプリが毎回別物になるため
- 実機は iPhone（Safari → ホーム画面に追加）と Android（Chrome）。オフラインは機内モードで確認する
- Preview を Deployment Protection で保護している場合、iOS のホーム画面アプリは Safari と Cookie を共有しないため、保護画面で止まることがある。そのときは、確認の間だけ Vercel の共有リンク（Shareable Link）を使う

**R0**
- [ ] 買い物完了・履歴の取り消し・履歴の削除で、自分のデータだけが変わる（別ユーザーの同名アイテムが変わらない。#64）
- [ ] アイテムの追加・タグ付け・リスト作成が従来どおり動く

**R1（SW）**
- [ ] オンラインで 1 回開いたあと、機内モードでアプリを起動しても、ホーム・リスト・履歴・タグ・設定が表示される
- [ ] （ゲスト）機内モードでアイテムを追加・チェックできる
- [ ] 機内モードで、キャッシュにないページを開くと `/~offline` の画面になる
- [ ] 旧 URL（`/lists/<id>`）のブックマークを開くと、`/lists/detail?id=<id>` に移る
- [ ] もう一度 develop にマージして Preview を更新すると、「新しいバージョンがあります［更新］」が出て、押すと更新される
- [ ] （kill switch の予行）Preview で `NEXT_PUBLIC_SW_ENABLED=false` にして再デプロイすると SW が解除され、元に戻すと再び登録される
- [ ] ログイン中の操作（tRPC）が従来どおり動く（SW が API をキャッシュしていない）

**R2a**
- [ ] Preview の DB にマイグレーションが適用されている（CI のジョブが成功している）
- [ ] アイテム・リスト・グループの操作が従来どおり動く

**R2b**
- [ ] アイテム・タグ・リストを削除すると一覧から消え、別の端末・家族のアカウントからも消えて見える
- [ ] 買い物完了・履歴の取り消しが従来どおり動く

**R3（ローカルファースト）**
- [ ] ログイン中に機内モードにしても、ゲストの表示に切り替わらず、自分のデータが見える（オフラインのバナーが出る）
- [ ] 機内モードでアイテムを追加・編集・削除し、リストを作成してチェックし、買い物を完了できる。未同期の件数が表示される
- [ ] 機内モードを解除すると、未同期の件数が 0 になり、家族の端末（または別のブラウザ）に反映される
- [ ] 自分がオフラインでアイテムをチェックしている間に、家族がオンラインで同じアイテムのメモを編集 → 復帰後、チェックとメモの両方が残る
- [ ] 家族がオンラインで削除したアイテムを、自分がオフラインで編集 → 復帰後、削除されている
- [ ] オフラインの間、グループの作成・参加のボタンが押せない
- [ ] 未送信の変更があるままログアウトしようとすると、確認ダイアログが出る
- [ ] （切り戻しの予行）Preview で `NEXT_PUBLIC_LOCAL_FIRST=false` にして再デプロイすると、未送信の変更が送られてから、従来の表示に戻る

**R4**
- [ ] R3 のチェックリストのうち、オフラインでの追加・同期・競合の 3 項目を再確認する（移行用コードの削除後も動く）

#### 各リリースの共通手順

実施者: Preview の確認と main へのマージの判断はユーザー本人。Claude は PR の作成、チェックリストの準備、CI の確認まで。

1. develop と main の差分を確認する（`git log origin/main..origin/develop`）。対象外の未リリースのコミットがあれば、先に別のリリースとして出す
2. develop への PR をマージし、Preview の自動デプロイと、Preview の DB へのマイグレーション（R2a 以降）の完了を確認する
3. **ユーザーが Preview で上のチェックリストを実施する。すべて OK になるまで main へは進まない**
4. DB の変更を含むリリース（R2a、R2b）の前に、Neon で本番ブランチのバックアップを作る
5. develop → main の PR を作り、CI（lint / test / build / E2E）が通ることを確認してマージする。**DB の変更を含むリリース（R2a、R2b）では、本番 DB への migrate を本番デプロイより先に当てる**（「デプロイとマイグレーションの順序」参照。仕組みは別 PR）
6. CI の `migrate` ジョブの成功と、Vercel の本番デプロイの完了を確認する（DB の変更を含むリリースでは、migrate が先に成功していること）
7. 本番で動作を確認し、家族に案内する（R1: 「圏外でも開けるようになりました」、R3: 「オフラインでも編集できるようになりました」）

### ロールバック

| リリース | 戻し方 |
|---------|-------|
| R1（SW） | **Vercel の Promote では SW が消えない**ので、kill switch の段階 1 → 必要なら段階 2 を前進デプロイする。ルート変更（O2）だけの問題なら Promote でよい |
| R2a / R2b | R2a は追加だけなので、戻す必要はない。R2b はアプリを Promote で戻せる。ただし R2b 以降に論理削除された行は、古いコードでは一覧に再び出てくる。戻す場合は `deleted_at IS NOT NULL` の行を物理削除する SQL を流す（バックアップを取ってから） |
| R3 | **`NEXT_PUBLIC_LOCAL_FIRST=false` で前進デプロイする**（Promote より優先）。サーバーファーストの表示に戻り、SyncEngine は drain モードで未送信のキューを送り切るので、端末内の変更を失わない。Promote で戻すと、未送信の変更はユーザー DB に残ったまま送られなくなる（再び R3 を出したときに送られる）。SW のキャッシュが古い JS を出し続ける場合は、強制更新（`MIN_CLIENT_RELEASE`）か kill switch を併用する |

## 実装ステップ（1 ステップ = 1 PR、500 行以下目安）

| # | PR | 主な内容 | 依存 | 規模目安 |
|---|----|---------|------|---------|
| O1 | `feat: Serwist を導入しアプリシェルをオフラインキャッシュ` | `@serwist/turbopack` の導入、`sw.ts`、プリキャッシュ、`/~offline`、`/api/**` を NetworkOnly に、キャッシュのバージョン管理、kill switch（段階 1・2）、SerwistProvider への置き換えと `public/sw.js` の自己解除化、Playwright の `offline` プロジェクト（`E2E_BUILD=true next build && E2E_TEST=true next start`、`serviceWorkers: "allow"`。テスト用 OTP ルートの条件は #61 の設計書と同じ）。既存のプロジェクトには `serviceWorkers: "block"` を設定。**この時点で、ゲストはオフラインでも完全に動く** | #65（Next.js 更新） | ~450 |
| O1b | `feat: SW の更新通知・強制更新を追加` | `UpdateAvailableToast`、`SKIP_WAITING` のメッセージ、`visibilitychange` / 1 時間ごとの `registration.update()`、`controllerchange` でのリロード、`/api/version` と最低リリース番号による強制更新 | O1 | ~300 |
| O2 | `refactor: リスト詳細を /lists/detail?id= の静的ルートに変更` | ルートの移動、旧 URL のリダイレクト、遷移元の修正、プリキャッシュ対象への追加、E2E の URL 修正 | O1b | ~200 |
| O3 | `feat: 同期用の列を追加（expand マイグレーション）` | `updated_at` / `field_modified_at` / `deleted_at` / インデックスの追加だけ（手書きの SQL。既存行の `updated_at` は `created_at` で埋める）。コードはまだ使わない | #64 | ~150（SQL を除く） |
| O3b | `feat: 削除を論理削除に変更しクライアントIDを受け入れ` | 既存の削除を論理削除に、取得クエリの `deleted_at IS NULL`、update / delete の WHERE にスコープ（#73-1）、通常の mutation でも `updated_at` / `field_modified_at` を更新、作成時のクライアント ID 受け入れ | O3 | ~400 |
| O4 | `feat: sync.push を実データに反映する冪等 API に作り直し` | 操作ごとの認可、パッチの検証と上限、フィールド単位の LWW と削除優先、`opId` による冪等化、`serverTime`、`protocolVersion`（#69 の push 部分を解消） | O3b、#68、#69（merge 部分） | ~500 |
| O5 | `feat: sync.pull をカーソル差分取得に作り直し` | カーソル（60 秒のさかのぼり、ステートメントタイムアウト）、tombstone、`tagIds` の埋め込み、メンバーシップ、ページング、`protocolVersion` | O3b（O4 とは独立だが、ルールに従い O4 のマージ後に着手） | ~350 |
| O6 | `feat: クライアント同期エンジン（push/pull/キュー圧縮）を実装` | Dexie v9（`versionchange` / `blocked` の処理）、ユーザーごとの DB、`meta`、リポジトリ層の土台、SyncEngine の push/pull/バックオフ/ロック/drain モード、キューの圧縮（`inflight` を除外、`fieldTimes` の統合）、`NEXT_PUBLIC_LOCAL_FIRST` フラグ、SyncProvider の組み込み（この PR では hook はまだ tRPC 直呼びのまま。同期エンジンは「キューが空なら pull するだけ」で動く） | O4, O5 | ~500 |
| O7 | `refactor: カタログ（items/tags）をローカルファーストに移行` | `useItems` / `useTags` / ミューテーションをリポジトリ経由に（フラグが false なら従来の tRPC の分岐）。マージ後のゲスト DB 消去と初回の全件 pull | O6 | ~400 |
| O8 | `refactor: 買い物（lists/listItems/history）をローカルファーストに移行` | `useLists` / `useListMutations` / `useHistory*` の移行（フラグで切り替え）、`finishShopping` / `revertHistory` の複合操作 | O7 | ~500 |
| O9 | `feat: オフライン時のセッション保持と同期状態 UI を追加` | `lastKnownUser`、`status: "offline"`、セッション切れの処理、ログアウト時の消去と確認、OfflineBanner / SyncStatusBadge / FailedOperationsSheet / 手動更新、オンライン限定操作の無効化 | O8、#61 の A3（AuthContext の置き換え） | ~450 |
| O10 | `docs: ADR-004/005 と同期実装状況を更新` | ADR の更新、`sync-implementation-status.md` の更新 | O9 | ~150 |
| O11 | `refactor: サーバーファーストの分岐と移行用コードを削除` | hook の tRPC 分岐、`NEXT_PUBLIC_LOCAL_FIRST` フラグ、`public/sw.js`（自己解除用）の削除 | O10、R3 から 2 週間安定 | ~300（削除が中心） |

- **セキュリティ Issue との順序**: #64 / #68 / #69 は既存の API の不具合で、本設計のサーバー側ステップ（O3 / O4）が同じサービス層に乗るため、**先に修正してマージする**。#65（依存更新）は O1 の前に行う
- **本番リリースの単位**は上の「リリース手順」に従う（R1 = O1〜O2、R2a = O3、R2b = O3b〜O5、R3 = O6〜O9 を同時、R4 = O10〜O11）
- **#61 との順序**: O1〜O8 は #61 と独立に進められる。O9 だけは #61 の A3 のマージ後に着手する。**#61 の切り替え（R1b）を先に本番へ出し、その後に O1 から始める**（決定事項 6。2026-11-17 の補足で、サーバー側の O3〜O5 は #61 より先に進める）。認証の置き換えが先に済んでいれば、O9 で `AuthContext` を二度書き換えずに済む
- O1 は単独でも価値が大きい（ゲストのオフライン起動が直る）。O1 だけ先行してもよい

## テスト計画

### ユニット（Vitest）

| 対象 | テスト内容 |
|------|-----------|
| キューの圧縮 | create+update / update+update / create+delete / update+delete の各組み合わせ、別のエンティティは圧縮しない、`inflight` の操作は圧縮しない（送信中の create + 後からの delete で delete が残る）、統合後の `fieldTimes` がフィールドごとに新しい方になる |
| 時刻の補正 | `serverTime` から offset を計算し、操作時刻に反映する |
| SyncEngine.push | applied/duplicate はキューから削除、conflict はローカルに上書き、rejected は failed、ネットワークエラーはバックオフ、401 は sessionExpired、100 件ごとの分割 |
| SyncEngine.pull | ページング、tombstone の削除、未送信の操作があるエンティティは上書きしない、グループ脱退時のデータ削除、60 秒のさかのぼりで重複した行を冪等に適用する |
| drain モード | `NEXT_PUBLIC_LOCAL_FIRST=false` でも未送信のキューを push し続け、空になったら止まる。新しい書き込みはキューに積まない |
| Dexie のバージョン更新 | `versionchange` で DB を閉じてリロード、`blocked` で案内を表示 |
| 強制更新 | `minClientRelease` が自分のリリース番号より大きいとモーダルを出し、更新処理を呼ぶ。`CLIENT_TOO_OLD` でも同じ。未送信のキューは消さない |
| 同期ロック | 同時に呼んでも 1 本しか走らない |
| リポジトリ | 書き込みとキューの記録がアトミック（失敗時は両方ロールバック）、ゲストではキューに積まない、`updatedAt` の更新 |
| `sync.push`（サーバー、DB を使う） | 正常系の create/update/delete、`field_modified_at` にキーがないフィールドは常に適用される、他人のデータは rejected で serverRow を返さない、所属外グループは rejected、**フィールド単位の LWW**（古い `fieldTimes` のフィールドだけ捨てて partial、別のフィールドは適用される）、古い操作を適用しても後から届いた新しい操作が却下されない（`updated_at` を LWW に使っていないこと）、削除済みへの update は conflict、opId の重複は duplicate、未来の時刻は丸められる、パッチのバリデーションエラーと上限、対応外の `protocolVersion` は `CLIENT_TOO_OLD` |
| `sync.pull`（サーバー、DB を使う） | カーソル以降の差分だけ返す（60 秒のさかのぼりを含む）、カーソルより前の時刻で後からコミットされた行も次の pull で取れる、deleted_at を含む、他人・所属外グループのデータを含まない、500 行でのページング |
| 論理削除 | 既存の取得系 API が削除済みの行を返さない |
| AuthContext のオフライン | ネットワークエラーかつ `lastKnownUser` あり → offline、401 → unauthenticated |
| SW の設定 | `runtimeCaching` で `/api/**`（trpc / auth / e2e / ogp）が NetworkOnly になる（matcher の単体テスト）、キャッシュ名に `CACHE_VERSION` の接頭辞が付く |
| キャッシュの掃除 | `activate` で、現在のバージョン以外の `sm-` キャッシュだけを削除し、他のキャッシュには触れない |
| kill switch | `NEXT_PUBLIC_SW_ENABLED=false` で `SWKillSwitch` が全登録の `unregister` とキャッシュ削除を呼ぶ。`SW_KILL_SWITCH=true` で route handler が自己消去用の SW を返す |
| 更新通知 | `waiting` の SW があるとトーストを出す。［更新］で `SKIP_WAITING` を送り、`controllerchange` で 1 回だけリロードする |
| UI | OfflineBanner の表示切り替え、バッジの件数、FailedOperationsSheet の破棄、オンライン限定ボタンの無効化 |

### E2E（Playwright）

オフラインのシナリオは `offline` プロジェクト（`E2E_BUILD=true next build && E2E_TEST=true next start` の本番ビルド、chromium、`serviceWorkers: "allow"`）で実行する。ログインは #61 のテスト用 OTP ルートを使う。このルートは `NODE_ENV` ではなく、`E2E_BUILD`（ビルド時）と `E2E_TEST`・`VERCEL_ENV`・`E2E_SEED_TOKEN`（実行時）で有効にするので、本番ビルドでもログインできる。SW が制御するまで待ってから（`navigator.serviceWorker.ready` の後に 1 回リロード）、`context.setOffline(true)` を使う。

| ID | シナリオ |
|----|---------|
| O-1 | （ゲスト）オンラインで 1 回開く → オフライン → リロードしてもホームが表示され、アイテムを追加できる |
| O-2 | （ゲスト）オフラインで未訪問のページ（タグ管理・履歴）に遷移できる。キャッシュにない URL は `/~offline` になる |
| O-3 | （ログイン）オフラインでアイテムを追加・編集・削除 → 未同期件数が表示される → オンライン復帰 → 件数が 0 になり、別のコンテキスト（user-b）に反映される |
| O-4 | （ログイン）オフラインでリストを作成 → 詳細を開いてチェック → 買い物完了 → 復帰後にサーバーの履歴に反映される |
| O-5 | （ログイン 2 ユーザー）**同じフィールド**: A がオフラインで名前を編集し、B がオンラインで後から名前を編集 → A が復帰すると B の名前が残る（LWW） |
| O-5b | （ログイン 2 ユーザー）**別のフィールド**: A が店内でオフラインのままリストのアイテムをチェックし、B が家でオンラインのまま後から同じアイテムのメモを編集 → A が復帰すると、**チェックとメモの両方が残る** |
| O-6 | （ログイン）A がオフラインで編集中に B が削除 → A が復帰すると削除される（削除優先） |
| O-7 | （ログイン）オフライン中はグループ作成ボタンが無効 |
| O-8 | （ログイン）未送信の変更があるままログアウト → 確認ダイアログ → 破棄 → ゲストモードに戻り、ユーザーのデータが残っていない |
| O-9 | SW の更新: 新しいビルドで更新トーストが出て、［更新］でリロードされる（可能なら。難しければ手動テストにする） |
| O-10 | kill switch: 通常の SW が有効な状態 → `SW_KILL_SWITCH=true` のビルドに切り替え → 登録が解除され、`sm-` のキャッシュが空になり、ページが通常どおり読める。`NEXT_PUBLIC_SW_ENABLED=false` でも同様 |
| O-11 | `/serwist/sw.js` のレスポンスに `Service-Worker-Allowed: /` と `Cache-Control: no-cache` が付き、`/api/trpc` のレスポンスに `Cache-Control: private, no-store` が付く |
| O-12 | 既存の `/sw.js` が登録された状態から、新しい SW に置き換わる（旧 SW を登録した状態を作ってから、新しいビルドを開く）。`/sw.js` だけが登録された端末は、自己解除の SW で登録が解除される |
| O-13 | フラグでの切り戻し: オフラインで変更 → `NEXT_PUBLIC_LOCAL_FIRST=false` のビルドで復帰 → 未送信の変更がサーバーに送られ、サーバーファーストの表示に反映される |
| O-14 | 強制更新: `MIN_CLIENT_RELEASE` を現在より大きくしたサーバーで起動 → 更新のモーダルが出てリロードされ、未送信の変更が失われない |
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
| #72 | 配列件数・payload サイズの上限、ページングがない | push は 1 リクエスト 100 件まで、パッチは JSON で 16KB まで（`REQUEST_LIMITS.recordBytes`）、pull は 1 回 500 行のページングにする（O4 / O5） |
| #71 | セキュリティヘッダがない | 上記の `worker-src` と SW スクリプトの Cache-Control |
| #65 | Next.js 16.1.5 の既知脆弱性 | O1 の前に #65 で Next.js を更新し、更新後のバージョンで `@serwist/turbopack` の動作を確認する |

## 考慮事項

- **IndexedDB の容量と退避**: Safari は、しばらく使われないサイトのストレージを削除することがある（ITP）。`navigator.storage.persist()` を要求し、削除されていたら全件 pull で復元する（サーバーが正なので、未送信の分以外は失われない）
- **未送信データの消失リスク**: ログアウトとストレージ削除の際に失われうる。前者は確認ダイアログで防ぎ、後者は「前面に戻ったら push」で未送信の時間を短くする
- **ID の衝突**: UUID v4 なので実質起きない。サーバーは主キーの衝突を、所有者が違えば rejected、同じなら更新として扱う
- **マージ（初回ログイン）との関係**: 既存の `sync.merge` と `DataMergeContext` は維持する。将来、マージを「ゲスト DB のデータを push に積み直す」形に統一できるが、本 Issue の対象外とする
- **パフォーマンス**: 読み取りを Dexie に一本化することで、画面の表示はサーバーファーストより速くなる。pull はカーソルによる差分取得なので、通信量は小さい
- **ADR の更新**: ADR-004 の「現在の実装状況：C: 現状維持」を「A: ローカルファースト移行」に、ADR-005 の `@serwist/next` を `@serwist/turbopack` に更新する（O10）
- **本番で同期の不具合が出たとき**: (1) `NEXT_PUBLIC_LOCAL_FIRST=false` で前進デプロイし、サーバーファーストに戻す（未送信のキューは drain される）。(2) サーバーが不正な操作を受けている場合は、`MIN_CLIENT_RELEASE` を上げて古いクライアントを強制更新する。(3) SW が原因なら kill switch。(4) `sync_operations` の `rejected` / `conflict` の件数をログで確認し、原因を調べる
- **本番の既存データ**: O3 のマイグレーションは列の追加だけにし、既存のデータを保持する。R3 のリリース直後は、既存のログインユーザーのユーザー DB が空なので、初回の全件 pull が走る（「## 本番環境への影響とリリース手順」参照）

## 決定事項（2026-11-16 ユーザー承認）

| # | 項目 | 決定 |
|---|------|------|
| 1 | ログイン中のデータアーキテクチャ | 端末の IndexedDB を正とする**ローカルファースト + outbox** に移行する（TanStack Query の永続化は採用しない） |
| 2 | 競合解決 | **パッチ送信 + 新しい操作が勝つ（LWW）+ 削除優先**で自動解決し、他の端末の変更で上書きされたときはトーストで知らせるだけ。選ばせる UI は作らない。設計レビューを受けて、LWW は**フィールド単位**で比べる（別々のフィールドの編集が両方残る） |
| 3 | リスト詳細の URL | `/lists/<id>` から **`/lists/detail?id=<id>`** に変更する。旧 URL はリダイレクトで残す |
| 4 | グループ管理 | グループの作成・参加・メンバー管理・招待コードの再生成は**オンライン時のみ** |
| 5 | 同期のタイミング | **イベント駆動のみ**（書き込み後・オンライン復帰時・前面に戻ったとき・手動更新）。定期的な自動取得はしない |
| 6 | #61 との順序 | **#61 を先に進め**、その後で本 Issue に着手する（O1 の SW キャッシュだけは先行してもよい）。**補足（2026-11-17 ユーザー決定）**: この順序を緩め、サーバー側の O3〜O5 を #61 より先に進める。develop まではマージし、本番へのリリース（R2a = O3、R2b = O3b〜O5）は、R1 の様子見が終わる 2026-11-24 以降にリーダーが判断する。O9 が #61 の A3 の後なのは変わらない |
