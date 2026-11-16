# パスキー + メールアドレス認証

> ステータス: **設計レビュー待ち**（未承認・未実装）
> 関連 Issue: #61（本機能）、#49（Vercel/Google OAuth 初期設定 → 内容更新が必要）、#62（オフライン対応。オフライン時のセッション扱いで連携）
> 関連セキュリティ Issue: #65（Auth.js / Next.js の既知脆弱性）、#70（E2E 用ログインのバックドア構造）、#72（レート制限なし）、#73-8（JWT セッションを失効できない）、#71（セキュリティヘッダ）。「## セキュリティ」節で対応関係を示す

## 概要

Google OAuth を廃止し、**メールアドレス + ワンタイムコード（OTP）** でアカウント作成・ログインし、ログイン後に**任意でパスキー（WebAuthn）を登録**して以後はパスキーでワンタップログインできるようにする。Google アカウントを持たない家族メンバーでも使えるようにすることが目的。

> **前提の確認が必要**: Issue #61 は「本番未デプロイ（#49 未完了）」としているが、2026-11-16 時点で Vercel の GitHub 連携（main → Production / develop → Preview）が稼働しているという記録がある。本設計は**本番に既存の Google ユーザーとデータがある前提**で、データを失わない移行を組み込む（「## 既存ユーザーの移行」参照）。本当に未利用なら、この節の作業は省略できる。

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
- OTP 送信の API は、登録済みかどうかに関わらず同じレスポンスを返す（メールアドレスの存在が分からないようにする）
- Resend の 1 日 100 通の上限に対しては、IP ごとのレート制限に加えて**メールアドレスごとの再送間隔（60 秒）** を設ける。上限に達したら「時間をおいて再試行」と表示する。ボット対策（Turnstile 等）は乱用が観測されたら別 Issue で検討する

### DB スキーマ（Drizzle）

Better Auth のコアスキーマ（user / session / account / verification）と passkey プラグインのテーブルに合わせる。`usePlural: true` で既存のテーブル名（`users` 等）を維持し、`groups` などから `users.id` への外部キーは変更しない。

| テーブル | 変更 |
|---------|------|
| `users` | `name` を NOT NULL（初期値 `''`）、`email_verified` を timestamp から boolean に変更。`image` は残す（未使用） |
| `sessions` | Better Auth の形に作り直す（`id`, `token`(unique), `user_id`, `expires_at`, `ip_address`, `user_agent`, `created_at`, `updated_at`） |
| `accounts` | Better Auth の形に作り直す（OAuth を使わないので行はほぼ入らないが、コアスキーマとして必要） |
| `verification_tokens` → `verifications` | `id`, `identifier`, `value`, `expires_at`, `created_at`, `updated_at`（OTP を保存） |
| `passkeys`（新規） | `id`, `name`, `public_key`, `user_id`(FK cascade), `credential_id`(unique), `counter`, `device_type`, `backed_up`, `transports`, `aaguid`, `created_at` |
| `rate_limits`（新規） | `storage: "database"` 用（`key`, `count`, `last_request`） |

- 正確なカラム定義は `npx @better-auth/cli generate` の出力を元に、`schema.ts` へ手で反映する（CLI に schema.ts を上書きさせない）
- `users` の行と ID はそのまま残す（グループ・アイテム等の外部キーを壊さない）。破棄するのは、既存のセッション（Auth.js の JWT はそもそも DB にない）、Google の `accounts` 行、`verification_tokens` だけ。データの変換は `users.email_verified` の型変換（NULL 以外を true）と、`name` が NULL の行を `''` にすることだけ
- マイグレーションは `drizzle-kit generate` で作り、テーブルを DROP せず ALTER / RENAME で書く（生成された SQL を目視で確認する）

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

本番に Google でログインしたユーザーがいる場合の扱い。

- **同じメールアドレスで OTP ログインすれば、同じユーザーとしてデータを引き継げる**。Google アカウントのメール（Gmail）は `users.email` に保存済みで、Better Auth の emailOTP はメールアドレスで既存ユーザーを引き当てる。Gmail に届いたコードを入力すればよい
- 切り替えたタイミングで、既存の Auth.js のセッション（JWT Cookie）は無効になり、**全員 1 回だけ再ログインが必要**になる。ログイン画面に「ログイン方法が変わりました。Google アカウントのメールアドレスでログインしてください」という告知を一定期間出す
- ゲストモードの IndexedDB のデータは、端末内に残るので影響はない
- 切り替え手順: A2 を develop（Preview）で確認 → 本番の DB をバックアップ（Neon のブランチ作成）→ main にマージ → 本番でマイグレーション → 自分のアカウントで再ログインして確認
- ロールバック: Neon のバックアップブランチに戻し、ひとつ前のデプロイを Vercel で Promote する

## 実装ステップ（1 ステップ = 1 PR、500 行以下目安）

依存順は「→」で表す。並行実装はしない（`.claude/rules/task-management.md`）。

| # | PR | 主な内容 | 依存 | 規模目安 |
|---|----|---------|------|---------|
| A1 | `feat: メール送信基盤（EmailSender/Resend）を追加` | `EmailSender` インターフェース、Resend / Console / TestMailbox の実装、OTP メールテンプレート、メールアドレスの正規化、環境変数の検証（Zod） | #65（依存更新） | ~250 |
| A2 | `feat: Better Auth に移行しメールOTP認証を導入` | Better Auth 本体（emailOTP・レート制限・cookieCache）、スキーマとマイグレーション、`[...all]` ルート、tRPC context、`AuthContext` の置き換え、ログイン画面の OTP UI（2 段階）、E2E ログインヘルパーとテスト用 OTP ルート、Credentials プロバイダ・next-auth・Google の削除 | A1 | ~500（マイグレーション SQL を除く） |
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

## セキュリティ

- OTP の総当たり対策: 試行 3 回で無効化、5 分で失効、送信とサインインにレート制限（DB ストレージ）
- メールアドレスの列挙対策: OTP 送信の結果を登録有無で変えない
- CSRF: Better Auth の Origin 検証と `trustedOrigins`、Cookie は `Secure` / `HttpOnly` / `SameSite=Lax`
- パスキー: `userVerification: "preferred"`、署名カウンタの検証はライブラリに任せる。RP ID は環境変数で固定し、リクエストの Host ヘッダから決めない
- E2E 用のテストルートは二重条件（`E2E_TEST` と `NODE_ENV`）で守り、本番ビルドで 404 になることをテストする
- **メールアドレスの正規化**（#65 で指摘された Auth.js のホモグリフ問題を、移行後に再発させない）: 送信・照合の前に `trim` + 小文字化 + Unicode NFKC で正規化し、Zod でメール形式を検証する。ASCII 以外を含むアドレス（IDN を含む）は当面拒否する。正規化後の値で `users.email` を一意にする

### セキュリティ Issue との対応

| Issue | 内容 | 本設計での扱い |
|-------|------|---------------|
| #65 | next-auth / @auth/core / Next.js の既知脆弱性 | **A2 で next-auth を削除するため、Auth.js 側は解消する**。ただし A2 のマージまでに時間がかかるので、#65 の依存更新（next-auth beta.32 以上、Next.js 16.4.x 以上）は**本 Issue より先に**行う。A1 は #65 の後に着手する。メール正規化は上記で対応 |
| #70 | `E2E_TEST` の環境変数 1 つでパスワードなしログインが有効になる | **A2 で Credentials プロバイダを削除する**。代わりの `/api/test/otp` は #70 の方針に合わせ、`E2E_TEST === "true"` かつ `NODE_ENV !== "production"` かつ `VERCEL_ENV` が production / preview でないことを条件にし、さらに `E2E_SEED_TOKEN` ヘッダを必須にする。本番条件で 404 になることをユニットテストで確認する。`/api/e2e/seed` の修正は #70 側で行う |
| #72 | レート制限がない | 認証系のエンドポイント（OTP 送信・サインイン・パスキー）は **Better Auth の rateLimit** で A2 から制限する。#72 で Upstash Redis などを導入する場合は、Better Auth の `secondaryStorage` を同じ Redis に向け、`storage: "secondary-storage"` に切り替える |
| #73-8 | JWT セッションを個別に失効できない | **DB セッションに変えることで解消する**（ログアウト・セッション削除が即時に効く）。将来「他の端末からログアウト」を設定画面に加える余地がある（本 Issue の対象外） |
| #71 | セキュリティヘッダがない | #71 で Permissions-Policy を入れる際、`publickey-credentials-get` / `publickey-credentials-create` を `self` で許可する（塞ぐとパスキーが動かない） |

## 考慮事項

- **iOS PWA**: 標準モードの PWA でもパスキー（Face ID）は使える。メールアプリから戻る際にアプリ切り替えが必要になるが、コード方式なので入力して完結する
- **Conditional UI 非対応ブラウザ**: パスキーボタンを明示的に置いているので問題ない。`PublicKeyCredential` がない環境ではボタンを出さない
- **共有端末**: パスキーは端末に保存されるため、共有端末では登録の提案を「あとで」にできる
- **既存データ**: ユーザー・グループは残る（`users.id` を維持）。同じメールアドレスで OTP ログインすれば、そのままグループに参加した状態になる
- **ゲストデータのマージ**: 既存の `DataMergeContext`（ログイン時に `trpc.sync.merge` を呼ぶ）は、セッション取得部分が `AuthContext` 経由なので動作は変わらない。E2E の L-1 / L-2 で回帰を確認する
- **メールが届かない**: 迷惑メールフォルダの案内を表示する。Resend のダッシュボードで送信ログを確認できる
- **AGENTS.md の記述が古い**（Prisma / next-pwa と書かれている）ので、A5 で直す

## ユーザーに確認したいこと

1. **認証ライブラリを Auth.js から Better Auth に移行してよいですか？**（推奨。Auth.js は保守のみの体制になり、パスキーは experimental のまま。代替は Auth.js を続けて experimental の Passkey とマジックリンクを使う案）
2. **メール認証は 6 桁コード（OTP）方式でよいですか？**（推奨。iOS のホーム画面アプリではマジックリンクだと Safari 側でログインしてしまうため）
3. **メール送信は Resend でよいですか？ また、送信元にできる独自ドメインはありますか？**（Resend / SES とも独自ドメインの DNS 設定が必要。ない場合はドメインの取得が先に必要）
4. **パスキーは任意（ログイン後に登録を提案）とし、復旧手段はメールのコードとする方針でよいですか？**（必須にはしない。Vercel のプレビュー環境ではドメインが毎回変わるため、パスキーを無効にしてメールのコードだけにする）
5. **初回ログイン時に表示名の入力を必須にしてよいですか？**（Google と違って名前が自動で入らないため。グループのメンバー表示に使う）
6. **本番環境に、すでに Google でログインして使っているユーザー（家族など）はいますか？**（Issue では「未デプロイ」となっているが、Vercel の本番デプロイは稼働している記録がある。いる場合は「同じメールアドレスでコードログインすれば引き継げる、切り替え時に 1 回だけ再ログインが必要」という移行でよいか）
