# Design: カタログ（商品・タグ）をローカルファーストに移す（#62 O7）

## Context

動機は proposal.md の Why。設計の正は `docs/features/offline-support.md`（「### クライアント」「**リポジトリ層**」「**SyncEngine**」「### 5. ローカル DB の分離」）。O6 までにあるもの:

- `src/lib/db/userDb.ts` の `getUserDb(userId)`（`ShoppingMemosDB-u-<userId>`）。開いているのは `SyncContext` だけ
- `src/infrastructure/local/repository.ts` の `createRecord` / `updateRecord` / `deleteRecord`（`LocalStore = { db, clock, queue }`。行とキューを 1 トランザクションで書く。`queue: false` で積まない）と、キューの圧縮（`syncQueue.ts`）。本番からはまだ呼ばれていない
- `SyncEngine`（push → pull。初回はカーソルなしの全件 pull。`meta.lastSyncAt` を保存）と `useSync()`（`engine`・`requestSync`・`sync`）。グループはキャッシュしない
- `useDataSource()` の `useServer = !!user && isMergeCompleted`（フラグを見ない）。hooks のゲストの分岐はゲスト DB に直接書く

## Goals / Non-Goals

**Goals:**
- カタログの hooks を、モードで決まる 1 つの経路（ゲスト DB・ユーザー DB・tRPC）にし、端末の DB の書き込みをリポジトリに集める
- ローカルファーストの見え方を、今のサーバーファーストと同じにする（並び・絞り込み・除外）。フラグを切り替えても、ログイン中の利用者には同じ一覧が見える
- フラグが false の本番の振る舞いを変えない

**Non-Goals:**
- proposal.md の Non-goals。とくに、ゲストの一覧の並びは変えない（`62-o7b-catalog-guest-alignment` で確認）

## Decisions

### D1. 経路の決め方（`useCatalogSource`）

| 状態 | 経路 | 書き込み |
|------|------|---------|
| ログインしていない | ゲスト DB（`db`） | `LocalCatalogRepository`（`queue: false`） |
| ログイン中・merge 前 | ゲスト DB（今と同じ。merge の後にリロードする） | 同上 |
| ログイン中・merge 済み・フラグ false | tRPC（今のまま） | tRPC |
| ログイン中・merge 済み・フラグ true | ユーザー DB（`getUserDb(userId)`） | `LocalCatalogRepository`（`queue: true`、時計は `engine.getClock()`）→ `requestSync()` |

- `useCatalogSource()` は `{ kind: "guest" \| "server" \| "local", store?: LocalStore, afterWrite: () => void, ready: boolean }` を返す。`local` で同期エンジン（`useSync().engine`）がまだない間（merge の直後の一瞬）は `ready: false` で、一覧は読み込み中にし、書き込みは受けずにエラー（「準備中です」）を返す（画面は一覧の `isLoading` の間ボタンを出さないので、通常は届かない）。エンジンができた後は、初回の同期の前でも書き込みを受けてキューに積む（pull は未送信の操作がある行を上書きしない）
- ゲストの `LocalStore` の時計は補正なしの端末の時計（`createClock(0)`）。`createRecord` は `createdAt` を入れないので、`catalogRepository` が `createdAt` と `updatedAt` を入れる
- `useDataSource()` は変えない（買い物の hooks が使う。O8 で同じ形にする）

### D2. `LocalCatalogRepository`（`src/infrastructure/local/catalogRepository.ts`）

- `createItem` / `updateItem` / `deleteItem` / `createTag` / `updateTag` / `deleteTag` を `LocalStore` の上に置く。ID はクライアントで採番する（`crypto.randomUUID()`）
- キューのパッチは sync.push の検証（`pushPatches.ts`）の範囲で、今の tRPC の mutation が送るものと同じにする（フラグの切り替えで振る舞いを変えない）: 商品の作成は `name・quantity・memo・tagIds・groupId`（memo・groupId は値があるときだけ）、更新は今の `catalog.updateItem` と同じ `name・quantity・tagIds` と、値があるときの `memo` だけ（メモの null は送らない＝今と同じく消せない。groupId と purchasedAt は送らない。カタログの hooks には購入状態を変える経路がない）、タグは `name`（作成は `groupId` も）。ユーザー DB の行も、パッチと同じフィールドだけを変える
- タグの削除は、`tags`・`items`・`syncQueue` の 1 トランザクションで、タグの削除（キューに `delete`）と、外した商品ごとの `update {tagIds}`（キューに積む）を行う。積まないと、送る前のタグの create + delete が圧縮で両方消えたとき、送る前の商品の create / update のパッチに消えたタグが残り、サーバーで `invalid_reference` として拒否されて商品が届かない。積めば、pending の create / update にまとめられてパッチが正しくなる。サーバーのタグの削除（`DrizzleTagRepository.softDelete`）の後に届いた update は、tagIds の時刻がサーバーのほうが新しければ partial で捨てられるだけで害はない
- 既存の `repository.ts` の関数を使う。Dexie は、外側のトランザクションのテーブルの一部を使う内側のトランザクションをそのまま使う

### D3. 端末の DB の読み取り（`src/hooks/data/catalogQueries.ts`）

- `queryItems(db, options)` と `queryTags(db, options)` を、`useLiveQuery` から呼ぶ純粋でない（DB を読む）関数として切り出し、fake-indexeddb でテストする
- 絞り込みは今のゲストの分岐と同じ（groupId・購入済み・タグの OR）。進行中のリストの除外は `excludeItemsInActiveLists`（#179）に、同じ groupId の進行中のリストの、リストに残っている商品の名前を渡す
- 並び: `order: "server" \| "guest"`。ローカルファーストは `server`（商品は `createdAt` の昇順、タグは名前の文字コードの順 `a < b`）、ゲストは今のまま（商品は `createdAt` の降順、タグは並べ替えない）
- タグの名前の順は、サーバー（`ORDER BY name`）と同じにできるとは限らない。サーバーの順は DB の照合順序で決まり、ローカルの postgres（en_US.utf8）と `localeCompare(…, "ja")` では結果が違った（reviewer の確認）。照合順序が C ならコードポイントの順で `a < b` と一致する。本番の Neon の照合順序は、本番 DB に触らない決まりのため実装の担当は確かめていない（リーダーに確認を頼む）。C でなければ、ローカルファーストに切り替えたときにタグの並びが変わりうる
- ユーザー DB にはサーバーが返した行だけがある（自分の個人のデータと所属グループのデータ）ので、個人の一覧は `groupId` がないことだけで絞ってよい（サーバーの「自分の個人のもの」と同じになる）

### D4. 初回の同期が終わるまで

- ユーザー DB の `meta.lastSyncAt` がなければ、一覧は読み込み中にする（`useLiveQuery` で `meta` を読む）。ログインの直後（merge の後のリロード）に空の一覧が一瞬出て、利用者が「データが消えた」と思わないようにする
- 初回の同期が失敗し続けると読み込み中のままになる。ログインの直後はオンラインのはず（merge が要る）なので受け入れ、状態の表示は O9 の同期の UI で扱う

### D5. 買い物の変更の後（O8 までのつなぎ）

- `useListMutations` / `useHistoryMutations` の `catalog.getItems.invalidate()` を `useCatalogSource().afterWrite` 相当の `refreshCatalog()` に置き換える: `server` なら今の invalidate、`local` なら `engine.sync()`（デバウンスなし。リストに入れた商品をすぐに一覧から外すため）、`guest` なら何もしない（`useLiveQuery` が追う）
- `refreshCatalog()` は同期の完了を待たない（await しない）。画面は `addItemToList` をループで呼ぶ（`lists/detail` の `handleAddItems`）ので、待つと 1 件ごとに同期を待つことになる。続けて呼ばれたときは、`SyncEngine.sync()` の「実行中に呼ばれたら終わった後に 1 回流す」でまとまる
- O8 で買い物もローカルファーストになれば、この同期は `requestSync()` だけになる

### D6. 所属グループのキャッシュ

- `SyncEngine` の transport に任意の `getGroups(): Promise<GroupCacheRow[]>` を足す。`full` モードの pull が終わった後に呼び、`groups` を 1 トランザクションで上書き（`bulkPut` と、結果にない行の削除）する。失敗したらキャッシュは変えず、同期は成功として扱う（lastSyncAt を記録）
- キャッシュの行: `id・name・inviteCode・inviteEnabled・createdAt・updatedAt・memberCount`。`getGroups` は `ownerId` を返さないので、`ownerId: ""` にする（キャッシュの行は表示だけに使い、権限の判定に使わない）。`getGroups` が返す `inviteCodeExpiresAt` は持たない（`useGroups` を使う画面は使っていない）
- `useGroups()` は、`local` ならユーザー DB の `groups` を `createdAt` の順に読み、`refetch` は `engine.sync()` にする。`server`・ゲストは今のまま
- `GroupContext` の「選んでいるグループが一覧にあるか」の確認は、今の tRPC のまま（オフラインのセッションは O9）
- `groupMembers` のキャッシュ（メンバー一覧）は O9 に回す（グループの詳細の画面はオンラインの管理画面で、オフラインでの表示の要件がない）

### D7. 画面からの Dexie の直書き

- `app/groups/page.tsx`: グループの作成・参加の後の、ゲスト DB への `groups` / `groupMembers` の書き込みをやめる。ログイン中は、どの読み取りもゲスト DB の `groups` を読まない（`useGroup` のゲスト DB の分岐は merge の前だけで、merge の後にリロードする）。代わりに `refetchGroups()` を呼ぶ（`local` では同期）
- `app/items/new/page.tsx`: 直し方（hooks 経由にするとログイン中の振る舞いが変わる・入り口のないページを消す）の判断が要るので、`62-o7b-catalog-guest-alignment` に分けた

### D8. フラグの既定と offline-support.md のずれ（design-doc 7.9 のうち O7 に関わるもの）

| 項目 | 決めたこと | offline-support.md の直し |
|------|----------|------------------------|
| フラグの既定 | コードの既定は false のまま（`"true"` のときだけ有効）。R3 で Vercel の環境変数 `NEXT_PUBLIC_LOCAL_FIRST=true` を Production と Preview に入れて有効にする。切り戻しは環境変数を false にして再デプロイ（drain で未送信を送り切る）。O11 でフラグごと消す | :383 の「`true`（R3 以降の既定）」を、環境変数で有効にする書き方に直し、リリース手順の R3 に環境変数の設定を足す |
| ローカルファーストの範囲 | O7 の後は、フラグが true ならカタログとグループの一覧が端末の DB を読む（買い物は O8） | 「4. データの流れ」の注意と、O6 の細部の「画面はユーザー DB を読まない」を、O7 の後の状態に直す |
| O7 の範囲 | 「マージ後のゲスト DB 消去」は #144 で済み。O7 は、カタログの移行・初回の同期の読み込み中・グループのキャッシュ | 実装ステップの O7 の行と、O6 の細部の「グループのキャッシュは O7 / O9」を直す |
| 同期のきっかけ | O7 から、カタログの書き込みの後に `requestSync()`、買い物・グループの変更の後に `sync()` を呼ぶ | 「4. 同期のタイミング」に、O7 の時点で呼ぶ場所を書く |

- 7.9 のほかの行（ロックの名前・`duplicate` の扱い・「現状」の表）は O7 に関わらないので、この change では直さない
- `docs/design-doc.md` の 7.9 の表の、直した行に「O7 で直した」と書く

### D9. 依存の向き

- hooks（クライアントの application 相当）→ `infrastructure/local`（リポジトリ）→ `lib/db`。hooks → `modules/shopping/domain`（除外の純粋関数）。domain は何も import しない
- `SyncEngine`（infrastructure/sync）は identity の型を import せず、transport の型（`GroupCacheRow`）を自分で持つ。`SyncContext` が `identity.getGroups` を transport に渡す

### D10. DB

サーバーの DB・API の変更はない。Dexie の version は上げない（`groups` に `memberCount` を足すが、インデックスではない。型 `Group` に任意の `memberCount` を足す）。

## Risks / Trade-offs

- [フラグが true のとき、買い物（tRPC）の変更が pull まで端末の DB に来ない] → D5 で変更の後にすぐ同期する。オフラインでは買い物の変更そのものができない（O8 まで）
- [初回の同期が終わらないと読み込み中のまま] → D4。O9 の同期の状態の表示で扱う
- [ローカルファーストで作った商品の `createdAt` は端末の時刻で、pull でサーバーの `createdAt`（`now()`）に置き換わる] → 古い順の並びで位置が少し動きうる（数秒の差なので、末尾に近い位置のまま）
- [タグの名前の順がサーバーと違いうる] → D3。本番の照合順序の確認を残す
- [グループのキャッシュの `ownerId` が空] → 表示にだけ使う。権限はサーバーが判定する
- [フラグが true の E2E がない] → ユニットテスト（fake-indexeddb）で経路・リポジトリ・読み取り・エンジンを確かめる。E2E は O9 で足す。フラグが false の E2E（今の全件）で、本番の経路が変わらないことを確かめる

## Migration Plan

本番はフラグが false のままなので、マージしても見える振る舞いは変わらない（ゲストの書き込みの `updatedAt` だけが変わる）。R3 で O8・O9 とまとめて、環境変数で有効にする。戻すときは revert でよい（ユーザー DB の形は変えていない）。
