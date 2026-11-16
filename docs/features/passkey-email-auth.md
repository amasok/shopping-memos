# パスキー + メールアドレス認証

> ステータス: **設計レビュー待ち**（未承認・未実装）
> 関連 Issue: #61（本機能）、#49（Vercel/Google OAuth 初期設定 → 内容更新が必要）、#62（オフライン対応。オフライン時のセッション扱いで連携）
> 関連セキュリティ Issue: #65（Auth.js / Next.js の既知脆弱性）、#67（招待コードの総当たり）、#70（E2E 用ログインのバックドア構造）、#72（レート制限なし）、#73-8（JWT セッションを失効できない）、#71（セキュリティヘッダ・CSRF）。「## セキュリティ」節で対応関係を示す

## 概要

Google OAuth を廃止し、**メールアドレス + ワンタイムコード（OTP）** でアカウント作成・ログインし、ログイン後に**任意でパスキー（WebAuthn）を登録**して以後はパスキーでワンタップログインできるようにする。Google アカウントを持たない家族メンバーでも使えるようにすることが目的。

> **前提（2026-11-16 確定）**: 本番は稼働している（Vercel の GitHub 連携で main → Production、develop → Preview）。Issue #61 本文の「本番未デプロイ」は誤り。本番には **Google でログインしている既存ユーザーが 1 家族**いる。移行は「同じメールアドレスなら既存の `users` 行に紐付け、家族に 1 回メールのコードでログインしてもらい、パスキーを登録してもらう」という単純な方式にする（「## 既存ユーザーの移行」参照）。段階的な廃止や Google との併用期間は設けない。

## ユーザーストーリー

- ユーザーとして、メールアドレスを入力し、届いた 6 桁のコードを入力するだけでアカウント作成・ログインできる（パスワード不要）
- ユーザーとして、ログイン後にパスキーを登録し、次回から Face ID / 指紋 / 画面ロックでログインできる
- ユーザーとして、ホーム画面に追加した PWA の中だけでログインを完結できる（Safari 等に飛ばされない）
- ユーザーとして、設定画面で登録済みパスキーの一覧確認・追加・削除ができる
- ユーザーとして、パスキーを登録した端末を失くしても、メールのコードでログインして復旧できる
- ユーザーとして、初回ログイン時に表示名を設定でき、グループのメンバー一覧でその名前が表示される

## UIフロー

```
【ログイン画面 /login】
  ┌──────────────────────────────────────────┐
  │              🛒 買い物メモ                 │
  │                                          │
  │  [🔑 パスキーでログイン]                   │ ← WebAuthn 対応ブラウザのみ表示
  │  ──────────── または ────────────          │
  │  メールアドレス [_______________]          │ ← autocomplete="username webauthn"
  │  [コードを送信]                            │   （対応ブラウザでは入力欄でパスキー候補が出る＝Conditional UI）
  └──────────────────────────────────────────┘
        │ [コードを送信]
        ▼
  ┌──────────────────────────────────────────┐
  │  xxx@example.com に 6 桁のコードを送信しました │
  │  コード [_ _ _ _ _ _]                     │ ← autocomplete="one-time-code", inputmode="numeric"
  │  [ログイン]                               │
  │  コードが届かない？ [再送信]（60秒後に有効）  │
  │  [メールアドレスを変更]                     │
  └──────────────────────────────────────────┘
        │ 認証成功
        ├─ 新規ユーザー（name 未設定）→【表示名設定】→【パスキー登録の提案】→ ホーム
        └─ 既存ユーザー
              ├─ パスキー未登録 かつ 提案を未スキップ →【パスキー登録の提案】→ ホーム
              └─ それ以外 → ホーム（callbackUrl）

【表示名設定（初回のみ・/onboarding）】
  表示名 [_________]  ※グループのメンバー一覧に表示されます
  [はじめる]

【パスキー登録の提案（ボトムシート）】
  「次回からパスキーで簡単にログインできます」
  [パスキーを登録]  [あとで]   ← 「あとで」は localStorage に記録し、次回以降は自動で出さない

【設定画面 /settings > アカウント】
  ログイン中: 表示名 / メールアドレス
  パスキー
   ・iPhone（2026/11/16 登録・最終使用 11/20） [削除]
   ・MacBook（…）                            [削除]
   [＋ パスキーを追加]
  [ログアウト]

【エラー表示】
  ・コード不一致: 「コードが正しくありません（残り N 回）」
  ・試行上限 / 期限切れ: 「コードの有効期限が切れました。再送信してください」
  ・送信レート超過: 「しばらく時間をおいてからお試しください」
  ・パスキー取消・失敗: 「パスキーでのログインを中止しました。メールでログインできます」
  ・オフライン: 「オフラインのためログインできません」（ボタン無効化）
```

## 技術選定（選択肢と推奨）

### 1. 認証ライブラリ

前提として、2026-11 時点の Auth.js の状況は次のとおり。

- Auth.js は Better Auth チームに合流した。今後はセキュリティ修正などの最小限の保守のみで、新規プロジェクトには Better Auth が推奨されている（[authjs.dev](https://authjs.dev/getting-started/migrating-to-v5)、[Better Auth blog](https://better-auth.com/blog/authjs-joins-better-auth)、[discussion #13252](https://github.com/nextauthjs/next-auth/discussions/13252)）
- next-auth v5 は今も beta のまま（5.0.0-beta.3x）
- Auth.js の Passkey プロバイダは今も **experimental** で、「本番利用は非推奨」と明記されている。依存は `@simplewebauthn/server@9` に固定されているが、SimpleWebAuthn の最新は v14 系（[Passkey provider](https://authjs.dev/getting-started/providers/passkey)、[SimpleWebAuthn](https://simplewebauthn.dev/docs/packages/server)）
- Auth.js の Email プロバイダは**マジックリンクのみ**で、OTP には対応していない（[Email](https://authjs.dev/getting-started/authentication/email)）

| 案 | 内容 | 評価 |
|----|------|------|
| **A. Better Auth へ移行（推奨）** | `better-auth` + Drizzle adapter + `emailOTP` プラグイン + `@better-auth/passkey` プラグイン（内部で SimpleWebAuthn を使用） | OTP・パスキー・レート制限・セッション管理が公式機能でそろう。Auth.js を使っている箇所は `src/infrastructure/auth/index.ts`、`api/auth/[...nextauth]`、`trpc/server.ts`、`AuthContext.tsx`、E2E ヘルパーだけなので、置き換え範囲は小さい。利用者が少ない今が最も移行コストが低い |
| B. Auth.js 継続 + Passkey（experimental）+ Resend（マジックリンク） | 現行構成の延長 | 変更は最小。ただし experimental の機能に依存し、保守もほぼ止まっている。マジックリンクは iOS の PWA で破綻する（後述）。OTP は Credentials で自作になり、レート制限・試行回数管理も自前 |
| C. Auth.js（JWT のみ）+ SimpleWebAuthn 直接 + 自作 OTP | 認証フローを自前で実装 | 自由度は最高。ただしセキュリティ上重要なコード（チャレンジ管理、カウンタ検証、OTP 総当たり対策）を自分で持つことになり、個人開発には過剰 |

**推奨: A（Better Auth）**。理由は、保守が続いているライブラリで要件（OTP・パスキー）をすべて公式機能で満たせることと、切り替えの影響範囲が狭いこと。

### 2. メール認証方式

| 案 | 評価 |
|----|------|
| **6 桁ワンタイムコード（推奨）** | iOS でホーム画面に追加した PWA は、メール内のリンクを Safari で開くため、マジックリンクだと **Safari 側にだけセッションができ、PWA はログインされない**。コードなら PWA 内で入力して完結する。iOS / Android ともに `autocomplete="one-time-code"` で自動入力の候補が出る |
| マジックリンク | 入力の手間が少ない。PWA 問題に加え、メールのプレビュー機能やセキュリティスキャナがリンクを先に踏んで無効化する問題もある |
| 両方（コード＋リンクを同じメールに記載） | リンク側で上記の問題が残るので、メリットが薄い |

設定値の推奨は、桁数 6・有効期限 5 分・試行 3 回まで（Better Auth `emailOTP` の既定値に近い）。未登録のメールアドレスでもログイン時にユーザーを自動作成する（サインアップとログインを分けない）。

### 3. メール送信サービス

| 案 | 料金・制約 | 評価 |
|----|-----------|------|
| **Resend（推奨）** | 無料枠は 100 通/日・3,000 通/月、独自ドメイン 3 つまで（[pricing](https://resend.com/pricing)） | SDK が簡単で、Vercel との相性が良い。家族利用の規模なら無料枠で十分。**送信元に独自ドメインの DNS 設定（SPF/DKIM）が必要** |
| AWS SES | $0.16 / 1,000 通程度（[pricing](https://aws.amazon.com/ses/pricing/)） | 安い。ただしサンドボックス解除の申請や IAM 設定が必要で、初期設定が重い |
| Cloudflare Email Sending | 2026-04 に public beta 開始。Workers Paid（$5/月）が必要という情報あり（[changelog](https://developers.cloudflare.com/changelog/product/email-service/)） | beta のため API 変更のリスクがある。Vercel 構成とも合わない |

実装では `EmailSender` インターフェースを用意する（`ResendEmailSender` / 開発・E2E 用の `ConsoleEmailSender`・`TestMailboxEmailSender`）。これでサービスの乗り換えと、テストでの差し替えを容易にする。

### 4. パスキーの位置づけ

| 案 | 評価 |
|----|------|
| **任意（推奨）** | 初回ログイン後にボトムシートで登録を提案し、設定画面からいつでも追加・削除できる。家族の端末によっては非対応・未設定の場合もあるため、必須にしない |
| 必須 | 安全性は最高。ただし非対応環境で詰む。共有端末や古い Android も考えると不適 |
| パスキーのみでサインアップ（メール不要） | Better Auth では `registration.requireSession: false` で可能。しかしパスキーを失うと復旧できないため採用しない |

### 5. アカウント復旧

- **メール OTP を常に復旧手段にする**。パスキーを失くした場合は、メールでログインして設定画面から古いパスキーを削除し、新しいものを登録する
- パスキーの削除は、ログイン中のユーザー本人だけができる。最後の 1 つを削除してもメールでログインできるので、ロックアウトにならない
- メールアドレスを変更する機能は本 Issue の対象外とする（必要になれば別 Issue。変更時は新アドレスへの OTP 確認を必須にする想定）

### 6. セッション

- Better Auth の**データベースセッション**（`sessions` テーブル）に、**cookieCache（署名付き Cookie に 5 分キャッシュ）** を組み合わせる。毎リクエストの DB 参照を減らしつつ、サーバー側で失効させられる。現行の JWT と違い、ログアウトやセッション削除が即時に効く
- 有効期限は 30 日、`updateAge` は 1 日（利用中は自動延長）。買い物アプリなので、長めにしてログインの手間を減らす
- オフライン時のセッションの扱い（最後にログインしていたユーザーとして閲覧・編集を続ける）は #62 の設計書で扱う。本設計では `AuthContext` に `status: "authenticated" | "unauthenticated" | "loading"` を持たせ、#62 側で `"offline"` を足せる形にしておく

### 7. パスキーの RP ID とプレビュー環境

- WebAuthn は RP ID（ドメイン）に紐づくため、パスキーは**本番ドメインと localhost でのみ有効**にする（`PASSKEY_RP_ID`、`BETTER_AUTH_URL` を環境ごとに設定）
- Vercel のプレビュー環境（`*-shopping-memos.vercel.app`）はデプロイごとにホストが変わるため、パスキーの UI を非表示にし、メール OTP だけでログインさせる（`NEXT_PUBLIC_PASSKEY_ENABLED=false`）

## 実装方針

### サーバー

```
src/infrastructure/auth/
├── index.ts            # betterAuth({...}) 本体（Auth.js の NextAuth を置き換え）
├── client.ts           # createAuthClient + emailOTPClient + passkeyClient
├── email/
│   ├── EmailSender.ts          # interface { sendOtp(email, otp, type) }
│   ├── ResendEmailSender.ts
│   ├── ConsoleEmailSender.ts   # 開発用（コンソールにコードを出力）
│   ├── TestMailboxEmailSender.ts # E2E 用（直近のコードを保持）
│   └── templates/otp.ts        # 件名・本文（日本語、コードと有効期限のみ。リンクは含めない）
└── session.ts          # getServerSession(): tRPC / Route Handler 用ヘルパー
src/app/api/auth/[...all]/route.ts   # toNextJsHandler(auth)
```

```typescript
// 方針イメージ（API 名は実装時に公式ドキュメントで再確認すること）
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  rateLimit: {
    enabled: true,
    storage: "database", // Vercel（サーバーレス）ではメモリを共有できないため
    customRules: {
      "/email-otp/send-verification-otp": { window: 60, max: 3 },
      "/sign-in/email-otp": { window: 60, max: 10 },
    },
  },
  advanced: { database: { generateId: () => crypto.randomUUID() } },
  plugins: [
    emailOTP({ otpLength: 6, expiresIn: 300, allowedAttempts: 3, sendVerificationOTP }),
    passkey({ rpID, rpName: "買い物メモ", origin }),
    nextCookies(), // 必ず最後
  ],
})
```

- tRPC の `createContext` は `auth.api.getSession({ headers: await headers() })` に置き換え、`Context` の型は変えない
- `trustedOrigins` に本番 URL を設定し、Better Auth の Origin 検証を有効のままにする（CSRF 対策）
- OTP 送信の API は、登録済みかどうかに関わらず同じレスポンス・同程度の応答時間を返す（メールアドレスの存在が分からないようにする）。エラーメッセージにも「未登録」などの文言を出さない
- OTP の保存と照合:
  - `verifications` には**ハッシュ化して保存**する（Better Auth `emailOTP` の `storeOTP: "hashed"`。オプション名は実装時に確認）
  - 照合は定数時間で比較する（ライブラリの実装を確認し、自前の比較は書かない）
  - 成功したらそのコードをすぐ削除する（使い回し不可）。新しいコードを送ったら古いコードは無効にする
- OTP 送信のレート制限は **IP 単位とメールアドレス単位の両方**にかける（メール爆撃と Resend のコスト対策、#72）
- tRPC の mutation でも `Origin` / `Sec-Fetch-Site` を確認し、別オリジンからのリクエストは 403 にする（tRPC の route handler に追加。#71 で指摘された CSRF 対策。Cookie 方式のセッションのまま、SameSite=Lax だけに頼らない）
- Resend の 1 日 100 通の上限に対しては、IP ごとのレート制限に加えて**メールアドレスごとの再送間隔（60 秒）** を設ける。上限に達したら「時間をおいて再試行」と表示する。ボット対策（Turnstile 等）は乱用が観測されたら別 Issue で検討する

### DB スキーマ（Drizzle）

Better Auth のコアスキーマ（user / session / account / verification）と passkey プラグインのテーブルに合わせる。`usePlural: true` で既存のテーブル名（`users` 等）を維持し、`groups` などから `users.id` への外部キーは変更しない。

| テーブル | 変更 |
|---------|------|
| `users` | `name` を NOT NULL（初期値 `''`）、`email_verified` を timestamp から boolean に変更。`image` は列を残すが、値は NULL にする（Google のアバター URL は `remotePatterns` 削除後に表示できないため。アバターはイニシャル表示にする）。`email` を正規化済みの値（trim・小文字）に揃える |
| `sessions` | Better Auth の形に作り直す（`id`, `token`(unique), `user_id`, `expires_at`, `ip_address`, `user_agent`, `created_at`, `updated_at`） |
| `accounts` | 「### accounts テーブルの扱い」参照 |
| `verification_tokens` → `verifications` | `id`, `identifier`, `value`, `expires_at`, `created_at`, `updated_at`（OTP を保存） |
| `passkeys`（新規） | `id`, `name`, `public_key`, `user_id`(FK cascade), `credential_id`(unique), `counter`, `device_type`, `backed_up`, `transports`, `aaguid`, `created_at` |
| `rate_limits`（新規） | `storage: "database"` 用（`key`, `count`, `last_request`） |

- 正確なカラム定義は `npx @better-auth/cli generate` の出力を元に、`schema.ts` へ手で反映する（CLI に schema.ts を上書きさせない）
- `users` の行と ID はそのまま残す（グループ・アイテム等の外部キーを壊さない）。データの変換は次の 3 つだけ
  - `users.email_verified` の型変換（NULL 以外を true）
  - `name` が NULL の行を `''` にする（既存の家族は Google の名前が入っているので、表示名の設定画面は出ない）
  - `image` を NULL にする
- 破棄してよいもの: `sessions`（JWT 方式なので空のはず）、`verification_tokens`（Google ログインでは未使用）
- マイグレーションは `drizzle-kit generate` で作り、`users` は ALTER だけで変更する（DROP しない）。生成された SQL を目視で確認する

### accounts テーブルの扱い

- 現在の `accounts` には、既存の家族の Google 連携の行（`provider = 'google'`、アクセストークンやリフレッシュトークンを含む）が入っている
- Better Auth の `account` モデルは列の構成が違う（`id`, `account_id`, `provider_id`, `user_id`, `access_token`, `refresh_token`, `id_token`, `access_token_expires_at`, `refresh_token_expires_at`, `scope`, `password`, `created_at`, `updated_at`）。そこで A2 のマイグレーションでは次のようにする
  1. 既存の `accounts` を `accounts_authjs_backup` にリネームする（ロールバック用の保険）
  2. 新しい形式の `accounts` を作る
  3. Google の行は移さない。Google ログインは廃止するので、トークンを持ち続ける理由がない
- メール OTP とパスキーのログインは、`accounts` に行がなくても動く（パスキーは `passkeys` テーブル。OTP はメールアドレスで `users` を引く）。Better Auth が内部で行を作る場合は、それに任せる
- `accounts_authjs_backup` は、本番で移行が完了して 2 週間問題がなければ、A5 で DROP する（中のトークンは Google 側でも無効にする。下記「既存ユーザーの移行」の手順 6）

### クライアント

- `src/contexts/AuthContext.tsx`: `next-auth/react` の `SessionProvider` / `useSession` を `authClient.useSession()` に置き換える。`login()` はログイン画面への遷移、`logout()` は `authClient.signOut()` に変更し、#62 のログアウト時データ消去フックを呼べるようにする
- `src/app/login/page.tsx`: メールの入力 → コード入力の 2 段階 UI、パスキーボタン、Conditional UI（`authClient.signIn.passkey({ autoFill: true })`）
- `src/app/onboarding/page.tsx`（新規）: 表示名の設定。`name === ''` のユーザーはここへ誘導する
- `src/components/auth/PasskeyPrompt.tsx`（新規）: 登録を提案するボトムシート
- `src/app/settings/page.tsx`: 「Googleでログイン」を「ログイン」に変更し、アカウント節（表示名・メール・パスキー管理）を追加
- `src/app/groups/page.tsx`: 「Googleでログイン」の文言を変更
- `next.config.ts`: `lh3.googleusercontent.com` の `remotePatterns` を削除

### E2E のログイン

- `E2E_TEST=true` のときだけ有効な Credentials プロバイダは**廃止**する。代わりに、E2E 時は `TestMailboxEmailSender` を使い、`GET /api/test/otp?email=` で直近のコードを取得して**本物の OTP フローでログイン**する
  - このテスト用ルートは `E2E_TEST === "true"` かつ `NODE_ENV !== "production"` のときだけ応答し、それ以外は 404 を返す。ユニットテストで、本番条件で 404 になることを保証する
- `e2e/auth/fixtures/auth-helpers.ts` は「OTP 送信 → テスト用ルートからコード取得 → `sign-in/email-otp`」を API 経由で行い、storageState を保存する
- パスキーの E2E は、Chromium の CDP（`WebAuthn.enable` / `WebAuthn.addVirtualAuthenticator`）で仮想認証器を使う

## 影響範囲

| ファイル | 変更 |
|---------|------|
| `package.json` | `next-auth`, `@auth/drizzle-adapter` を削除し、`better-auth`, `@better-auth/passkey`, `resend` を追加 |
| `src/infrastructure/auth/**` | 作り直し（上記） |
| `src/app/api/auth/[...nextauth]/route.ts` | `[...all]/route.ts` に置き換え |
| `src/app/api/test/otp/route.ts` | 新規（E2E 専用） |
| `src/infrastructure/trpc/server.ts` | `createContext` のセッション取得を変更 |
| `src/infrastructure/db/drizzle/schema.ts` + `migrations/` | 認証テーブルを変更（上記） |
| `src/contexts/AuthContext.tsx` | Better Auth クライアントに置き換え |
| `src/app/login/page.tsx`, `src/app/onboarding/page.tsx`, `src/components/auth/*` | UI の追加・変更 |
| `src/app/settings/page.tsx`, `src/app/groups/page.tsx` | 文言の変更、パスキー管理の追加 |
| `next.config.ts` | Google 画像ドメインの削除 |
| `e2e/auth/**`, `playwright.config.ts` | ログインヘルパーの変更、パスキーの spec を追加 |
| `src/types/next-auth.d.ts`（存在すれば） | 削除 |
| `docs/INFRASTRUCTURE.md`, `AGENTS.md`, Issue #49 | Google OAuth の手順を、Resend のドメイン設定と環境変数の手順に置き換え |

環境変数:

| 削除 | 追加 |
|------|------|
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET`（`AUTH_SECRET`）, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `PASSKEY_RP_ID`, `NEXT_PUBLIC_PASSKEY_ENABLED` |

## 既存ユーザーの移行

対象は本番の 1 家族だけなので、併用期間を設けない**一括切り替え**にする。

- **紐付けの方法**: 同じメールアドレスなら、既存の `users` 行に紐付ける。Google ログイン時に保存された Gmail アドレスが `users.email` に入っているので、そのアドレスで OTP ログインすれば同じ `users.id` になる。グループ・アイテム・リスト・履歴はそのまま見える
- **手順**
  1. 事前に家族へ連絡する（「○日からログイン方法が変わります。Gmail のアドレスにコードが届きます」）
  2. A2 を本番にリリースする（下記「## 本番環境への影響とリリース手順」）
  3. 切り替えた時点で、既存の Auth.js のセッション（JWT Cookie）は読めなくなり、家族の端末はログアウト状態になる。ログイン画面に「ログイン方法が変わりました。以前 Google で使っていた Gmail アドレスを入力してください」という案内を出す（A5 で削除）
  4. 家族がそれぞれの端末で、Gmail アドレス + コードでログインする → 同じデータが見えることを確認する
  5. A4（パスキー）のリリース後、ログイン後の提案から各端末でパスキーを登録してもらう。これで移行は完了
  6. 移行完了を確認したら、Google Cloud Console の OAuth クライアントを削除し、Vercel の `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を消す。2 週間後に `accounts_authjs_backup` を DROP する
- ゲストモードの IndexedDB のデータは端末内に残るので、影響はない
- **ログアウト状態になった後のデータ**: 同期済みのデータはサーバーにある。切り替え前の Google ログイン中は tRPC を直接呼んでいたので、端末内に未送信のデータはない

## 本番環境への影響とリリース手順

### 本番への影響

| 項目 | 影響 |
|------|------|
| 既存の家族 | 切り替え時に 1 回ログアウトされ、メールのコードで再ログインが必要。データは失われない |
| DB | `users` の ALTER、`sessions` / `accounts` / `verifications` の作り直し、`passkeys` / `rate_limits` の追加 |
| 環境変数（Vercel Production / Preview） | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `PASSKEY_RP_ID`, `NEXT_PUBLIC_PASSKEY_ENABLED` を追加。Google の変数は手順 6 で削除 |
| 外部サービス | Resend のアカウントと送信ドメインの DNS（SPF / DKIM）。DNS の反映待ちがあるので、A2 のリリースより前に済ませる |
| Preview 環境 | develop へのマージで自動デプロイされる。メールは実際に送られるため、Preview でも Resend を使う（送信先は自分のアドレスで確認）。`E2E_TEST` は Preview に**絶対に設定しない**（#70） |
| デプロイとマイグレーションの順序 | Vercel のデプロイと CI の `migrate` ジョブ（main への push で `drizzle-kit migrate`）は、互いを待たずに並行して走る。A2 のマイグレーションは後方互換ではないため、数分間ログインできない時間が出うる。家族が使わない時間帯にリリースし、事前に連絡する |

### リリース手順（develop → main）

各ステップの PR を develop にマージするたびに、Preview で確認する。本番へは次の単位でまとめてリリースする。

| リリース | 含める PR | 備考 |
|---------|----------|------|
| R0 | #65（依存パッケージの更新）、#67（招待コード対策） | 認証移行より前に本番へ出す。メールでアカウントを作りやすくなると、招待コードの総当たりが悪化するため |
| R1 | A1 + A2 + A3 | 一括切り替え。この時点で Google ログインはなくなる |
| R2 | A4 | パスキー。家族に登録してもらう |
| R3 | A5 | ドキュメント、`accounts_authjs_backup` の DROP、移行の案内の削除 |

各リリースの手順:

1. develop と main の差分を確認する（`git log origin/main..origin/develop`）。今回の対象外の未リリースのコミットがあれば、先に別のリリースとして出す
2. Preview（develop）で、OTP ログイン、既存ユーザーとしてのログイン（Preview の DB に本番相当のテストユーザーを用意）、グループ共有、ログアウトを手動で確認する
3. Neon で本番ブランチのバックアップ（`backup-before-r1` など）を作る
4. develop → main の PR を作り、CI（lint / test / build / E2E）が通ることを確認してマージする
5. CI の `migrate` ジョブの成功と、Vercel の本番デプロイの完了を確認する
6. 自分のアカウントで本番にログインし、データが見えることを確認する → 家族に案内する

### ロールバック

- **アプリ**: Vercel で 1 つ前の本番デプロイを Promote する
- **DB**: R1 のマイグレーションは後方互換ではないので、アプリだけを戻すと Auth.js が動かない。Neon のバックアップブランチを本番に戻す（R1 以降に作られたデータは失われるが、家族 1 組なので許容する）。`accounts_authjs_backup` があるので、Google 連携の行を手で戻すこともできる
- 判断の目安: リリース後 30 分以内に家族のログインが確認できない、または 500 エラーが続く場合はロールバックする

## 実装ステップ（1 ステップ = 1 PR、500 行以下目安）

依存順は「→」で表す。並行実装はしない（`.claude/rules/task-management.md`）。

| # | PR | 主な内容 | 依存 | 規模目安 |
|---|----|---------|------|---------|
| A1 | `feat: メール送信基盤（EmailSender/Resend）を追加` | `EmailSender` インターフェース、Resend / Console / TestMailbox の実装、OTP メールテンプレート、メールアドレスの正規化、環境変数の検証（Zod） | #65（依存更新）、#67（招待コード対策） | ~250 |
| A2 | `feat: Better Auth に移行しメールOTP認証を導入` | Better Auth 本体（emailOTP・レート制限・cookieCache）、スキーマとマイグレーション、`[...all]` ルート、tRPC context、`AuthContext` の置き換え、ログイン画面の OTP UI（2 段階）、E2E ログインヘルパーとテスト用 OTP ルート、Credentials プロバイダ・next-auth・Google の削除、`accounts` の退避、tRPC mutation の Origin 確認、ログイン画面の移行案内 | A1 | ~500（マイグレーション SQL を除く） |
| A3 | `feat: 初回ログイン時の表示名設定を追加` | `/onboarding`、`name === ''` のときの誘導、`users.name` 更新用の tRPC（`identity.updateProfile`）、設定画面のアカウント節（表示名・メール） | A2 | ~300 |
| A4 | `feat: パスキーの登録・ログイン・管理を追加` | passkey プラグイン、`passkeys` テーブル、ログイン画面のパスキーボタンと Conditional UI、登録提案のボトムシート、設定画面のパスキー一覧・追加・削除、プレビュー環境での無効化 | A3 | ~450 |
| A5 | `docs: 認証方式変更に伴いインフラ手順を更新` | `docs/INFRASTRUCTURE.md`、`AGENTS.md`（Prisma → Drizzle の記述修正も含む）、`.env.example`、#49 の本文更新（Google OAuth の手順を Resend / DNS の手順に置き換え） | A4 | ~150 |

- A2 は差分が大きくなりやすい。超えそうなら「A2a: サーバー側の置き換え（ログイン画面は最小限のフォーム）」と「A2b: ログイン画面の UI 仕上げ（再送のカウントダウン、エラー表示、a11y）」に分ける
- #62（オフライン）の「オフライン時のセッション保持」ステップは A2 に依存する

## テスト計画

### ユニット（Vitest）

| 対象 | テスト内容 |
|------|-----------|
| `EmailSender` 各実装 | Resend SDK をモックし、宛先・件名・本文（コード・有効期限を含み、URL を含まない）を検証。送信失敗時に例外を正しく伝えること |
| OTP メールテンプレート | 日本語の本文、コードの桁数、HTML エスケープ |
| 環境変数の検証 | 本番で `RESEND_API_KEY` / `BETTER_AUTH_SECRET` が欠けていたら起動時エラー、開発時は Console 送信にフォールバック |
| `/api/test/otp` ルート | `E2E_TEST` が未設定、または `NODE_ENV=production` のときに 404。E2E 時は直近のコードを返す |
| tRPC `createContext` | セッションあり → `userId` を設定、なし → undefined。`protectedProcedure` が 401 を返す |
| マイグレーション（DB を使うテスト） | Auth.js 形式のデータ（Google の `accounts` 行、`email_verified` が timestamp、大文字を含む email）を入れた DB にマイグレーションを適用 → `users` の行と ID が残る、`email_verified` が boolean、email が小文字、`accounts_authjs_backup` に Google の行が退避される |
| `identity.updateProfile` | 正常系、空文字・50 文字超でバリデーションエラー、他人の更新不可 |
| `AuthContext` | ローディング → 認証済み / 未認証の遷移、`logout` で signOut とデータ消去フックが呼ばれる |
| ログイン画面 | メール形式のバリデーション、送信後にコード入力へ切り替わる、再送ボタンの 60 秒クールダウン、エラーメッセージ、オフライン時はボタンが無効 |
| パスキー管理 UI | 一覧表示、削除の確認ダイアログ、`NEXT_PUBLIC_PASSKEY_ENABLED=false` で非表示 |

### E2E（Playwright）

| ID | シナリオ |
|----|---------|
| L-1 | 新規メールアドレスで OTP ログイン → 表示名を設定 → ホームに表示される |
| L-2 | 既存ユーザーが OTP ログイン → ホームへ直行する |
| L-3 | 誤ったコードを 3 回入力 → 期限切れ扱いになり、再送で成功する |
| L-4 | ログアウト → 保護されたデータが見えず、ゲストモードに戻る |
| L-5 | パスキー登録（仮想認証器）→ ログアウト → パスキーでログイン（chromium のみ） |
| L-6 | 設定画面でパスキーを削除 → パスキーでログインできず、OTP ではログインできる |
| L-7 | 既存の `e2e/auth/**`（グループ共有など）が新しいログインヘルパーで全件パスする |
| L-8 | 既存ユーザーの移行: Google ログインで作られた想定の `users` 行（name・Gmail アドレスあり）とグループ・アイテムを seed → 同じアドレスで OTP ログイン → 同じ `users.id` で既存データが見え、表示名の設定画面が出ない |

## セキュリティ

- OTP の総当たり対策: 試行 3 回で無効化、5 分で失効、送信とサインインにレート制限（DB ストレージ）
- メールアドレスの列挙対策: OTP 送信の結果を登録有無で変えない
- CSRF: Better Auth の Origin 検証と `trustedOrigins`、Cookie は `Secure` / `HttpOnly` / `SameSite=Lax`
- パスキー: `userVerification: "preferred"`、署名カウンタの検証はライブラリに任せる。RP ID は環境変数で固定し、リクエストの Host ヘッダから決めない
- E2E 用のテストルートは多重条件（`E2E_TEST`・`NODE_ENV`・`VERCEL_ENV`）と共有シークレットで守り、本番条件で 404 になることをテストする。可能ならルート自体を本番ビルドに含めない（`E2E_TEST` のときだけ有効になる `pageExtensions`、または別のエントリで分ける）
- **メールアドレスの正規化**は「Unicode 正規化（NFKC）→ trim・小文字化 → 形式の検証」の順に行う（#65）
- OTP はハッシュ化して保存し、照合は定数時間、使用後はすぐ無効にする
- **メールアドレスの正規化の詳細**（#65 で指摘された Auth.js のホモグリフ問題を、移行後に再発させない）: 送信・照合の前に正規化する。ASCII 以外を含むアドレス（IDN を含む）は当面拒否する。正規化後の値で `users.email` を一意にする

### セキュリティ Issue との対応

| Issue | 内容 | 本設計での扱い |
|-------|------|---------------|
| #65 | next-auth / @auth/core / Next.js の既知脆弱性 | **A2 で next-auth を削除するため、Auth.js 側は解消する**。ただし A2 のマージまでに時間がかかるので、#65 の依存更新（next-auth beta.32 以上、Next.js 16.4.x 以上）は**本 Issue より先に**行う。A1 は #65 の後に着手する。メール正規化は上記で対応 |
| #70 | `E2E_TEST` の環境変数 1 つでパスワードなしログインが有効になる | **A2 で Credentials プロバイダを削除する**。代わりの `/api/test/otp` は #70 の方針に合わせ、`E2E_TEST === "true"` かつ `NODE_ENV !== "production"` かつ `VERCEL_ENV` が production / preview でないことを条件にし、さらに `E2E_SEED_TOKEN` ヘッダを必須にする。本番条件で 404 になることをユニットテストで確認する。`/api/e2e/seed` の修正は #70 側で行う |
| #67 | 招待コードを総当たりで推測できる | メール認証でアカウントを量産しやすくなると悪化する。**R1 より前（R0）に #67 を本番へ出す** |
| #72 | レート制限がない | 認証系のエンドポイント（OTP 送信・サインイン・パスキー）は **Better Auth の rateLimit** で A2 から制限する。#72 で Upstash Redis などを導入する場合は、Better Auth の `secondaryStorage` を同じ Redis に向け、`storage: "secondary-storage"` に切り替える |
| #73-8 | JWT セッションを個別に失効できない | **DB セッションに変えることで解消する**（ログアウト・セッション削除が即時に効く）。将来「他の端末からログアウト」を設定画面に加える余地がある（本 Issue の対象外） |
| #71 | セキュリティヘッダがない。tRPC で Origin を確認していない | A2 で tRPC mutation の `Origin` / `Sec-Fetch-Site` 確認を入れる。Better Auth の `trustedOrigins` には本番 URL だけを設定する（Preview は環境変数で追加する）。#71 で Permissions-Policy を入れる際、`publickey-credentials-get` / `publickey-credentials-create` を `self` で許可する（塞ぐとパスキーが動かない） |

## 考慮事項

- **iOS PWA**: 標準モードの PWA でもパスキー（Face ID）は使える。メールアプリから戻る際にアプリ切り替えが必要になるが、コード方式なので入力して完結する
- **Conditional UI 非対応ブラウザ**: パスキーボタンを明示的に置いているので問題ない。`PublicKeyCredential` がない環境ではボタンを出さない
- **共有端末**: パスキーは端末に保存されるため、共有端末では登録の提案を「あとで」にできる
- **既存データ**: ユーザー・グループは残る（`users.id` を維持）。同じメールアドレスで OTP ログインすれば、そのままグループに参加した状態になる
- **家族が Gmail 以外のアドレスに変えたい場合**: メールアドレスの変更機能は対象外。必要なら、リリース前に DB の `users.email` を手で更新する（1 家族なので手作業で足りる）
- **ゲストデータのマージ**: 既存の `DataMergeContext`（ログイン時に `trpc.sync.merge` を呼ぶ）は、セッション取得部分が `AuthContext` 経由なので動作は変わらない。E2E の L-1 / L-2 で回帰を確認する
- **メールが届かない**: 迷惑メールフォルダの案内を表示する。Resend のダッシュボードで送信ログを確認できる
- **AGENTS.md の記述が古い**（Prisma / next-pwa と書かれている）ので、A5 で直す

## ユーザーに確認したいこと

1. **認証ライブラリを Auth.js から Better Auth に移行してよいですか？**（推奨。Auth.js は保守のみの体制になり、パスキーは experimental のまま。代替は Auth.js を続けて experimental の Passkey とマジックリンクを使う案）
2. **メール認証は 6 桁コード（OTP）方式でよいですか？**（推奨。iOS のホーム画面アプリではマジックリンクだと Safari 側でログインしてしまうため）
3. **メール送信は Resend でよいですか？ また、送信元にできる独自ドメインはありますか？**（Resend / SES とも独自ドメインの DNS 設定が必要。ない場合はドメインの取得が先に必要）
4. **パスキーは任意（ログイン後に登録を提案）とし、復旧手段はメールのコードとする方針でよいですか？**（必須にはしない。Vercel のプレビュー環境ではドメインが毎回変わるため、パスキーを無効にしてメールのコードだけにする）
5. **初回ログイン時に表示名の入力を必須にしてよいですか？**（Google と違って名前が自動で入らないため。グループのメンバー表示に使う）
