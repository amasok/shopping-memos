# Design: 初回の表示名の設定と、設定画面のアカウント欄

## Context

A3 で Better Auth に切り替え、新しいユーザーは `name: ''` で作られる（A3a の design の D3）。tRPC の `Context` の `user.name` と、`AuthContext` の `user.name` は Better Auth のセッションから来る。グループのメンバー一覧は `users.name` を DB から読む（`DrizzleGroupRepository`）。

## Goals / Non-Goals

**Goals:** proposal の What Changes。**Non-Goals:** proposal の Non-goals。

## Decisions

### D1. 表示名の検証は shared の schema に置く

- `src/shared/schemas/profile.ts`（新規）に `displayNameSchema`（NFKC → 前後の空白を除く → 1〜50 文字 → 改行・制御文字（C0・C1、行と段落の区切りの U+2028・U+2029）と Unicode の書式の文字（一般カテゴリ Cf。U+200B〜200D・U+202A〜202E・U+2066〜2069・U+FEFF など）を拒否）を置き、画面（`/onboarding`・設定の変更）とサーバー（`identity.updateProfile`）で共用する。domain の純粋な規則で、Drizzle・tRPC を import しない
- 上限の値は `TEXT_LIMITS.displayName`（50）に足す。数えるのはコードポイント（`[...s].length`。絵文字 1 つが 1 文字）。画面の入力欄の上限も同じ数え方にする（`maxLength` は UTF-16 で数えるので使わず、schema の検証で知らせる）
- NFKC は書式の文字を消さないので、正規化とは別に `\p{Cf}` で確かめる（グループのメンバー一覧で、表示を崩したり、ほかの家族の名前に見せかけたりできないように）

### D2. 保存は tRPC の `identity.updateProfile`

- `protectedProcedure` で、`ctx.userId` の行の `users.name`・`updated_at` だけを更新する（入力の schema は `{ name }` だけで、`userId` などの余計なキーは捨てる。他人の表示名は変えられない）。返り値は保存した表示名
- Better Auth の `/update-user` は開かない（許可リストに入れない。`image` などほかの項目を利用者が書き換えられないように）
- 保存の後、クライアントは `authClient` のセッションを取り直す（`useSession` の `refetch`）。`AuthContext` の `user.name` が新しい値になり、誘導が止まる

### D3. 表示名の設定への誘導は、画面の共通の部品で行う

- `OnboardingGate`（`src/components/auth/`）を `AuthProvider` の内側に置く。`status === "authenticated"` かつ `user.name === ""` で、今のパスが `/onboarding` でなければ、`/onboarding?callbackUrl=<今のパス>` に `router.replace` する
- 誘導しないパス: `/onboarding` と、オフラインのフォールバック（`/~offline`）。オフラインでは `user` が null（A3a の sessionKnown）なので、そもそも誘導されない
- `/onboarding` は、ログインしていない・表示名がある人が開いたら、戻り先（`safeCallbackPath`）かホームに移す
- `/onboarding` に「ログアウト」を置く（`AuthContext.logout`。ログイン中だけの状態を消してゲストに戻る）。まちがったアドレスでログインした人や、共有の端末で始めた人が、表示名を決めずに抜けられるように
- サーバー側（tRPC）は表示名が空でも動かす（誘導は画面だけ）。表示名が空のまま API を呼ばれても、データの整合は崩れない
- ログインの成功の後は今までどおり戻り先を読み込み直し、そこで `OnboardingGate` が誘導する（ログイン画面に分岐を持たない）
- ゲストの DB の取り込み（`DataMergeContext`）が片づく（`isMergeCompleted` か `error`）まで、誘導しない。merge は終わると画面を読み込み直すので、先に誘導すると入れかけた表示名が消える（E2E で見つけた。ゲストのデータがなければすぐ片づく）

### D4. すべての端末からログアウト

- Better Auth の `revokeSessions`（`POST /api/auth/revoke-sessions`。有効なセッションが要る。fresh session は求めない）を使う。route の許可リストに足し、POST なのでオリジンの確認もかかる
- クライアントは `AuthContext.logoutAllDevices()` で、ログイン中だけの状態を消し（今の `logout` と同じ）、`authClient.revokeSessions()` を呼び、ホームを読み込み直す。cookieCache を使っていない（A3a の D5）ので、ほかの端末もすぐ無効になる

### D5. 設定画面のアカウント欄

- ログイン中: 表示名・メールアドレス・「表示名を変更」（ボトムシートで入力。D1 の検証）・「すべての端末からログアウト」（確認のダイアログ）・「ログアウト」（今のまま）
- パスキーの欄は A5 で足す

### D6. E2E

- ログインのヘルパー（`loginWithOtp`・`loginAndSaveState`）は、ログインの後に `identity.updateProfile` で表示名を入れる（入れないと、既存の E2E が `/onboarding` に誘導される）。tRPC の mutation なので、A3a の D6 のオリジンの確認がかかる。`Origin` ヘッダを付けて呼ぶ
- 表示名の設定の画面の E2E は、ヘルパーを使わずに画面からログインして確かめる

## Risks / Trade-offs

- [誘導が画面だけで、API は表示名が空でも動く] → 表示名は表示のためだけの値で、権限や所有に使っていないので受け入れる
- [`revokeSessions` でこの端末もログアウトする] → 確認のダイアログで伝える（proposal の決めてほしいこと 4）
