# パスキー + メールアドレス認証

> ステータス: **方針承認済み（2026-11-16）・設計レビュー対応中**（未実装）
> 関連 Issue: #61（本機能。依存: #65, #70, #72）、#49（Vercel/Google OAuth 初期設定 → 内容更新が必要）、#62（オフライン対応。オフライン時のセッション扱いで連携）
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
   [＋ パスキーを追加]   ← 追加・削除は直近 10 分以内にログインしたセッションのみ（古ければコードで再確認）
  [すべての端末からログアウト]
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

- Better Auth の**データベースセッション**に、**cookieCache（署名付き Cookie に 5 分キャッシュ）** を組み合わせる。毎リクエストの DB 参照を減らしつつ、サーバー側で失効させられる
- 失効のタイミング:
  - ログアウトした端末では即時に無効になる（Cookie を削除する）
  - 「すべての端末からログアウト」や、セッション行の削除で他の端末を失効させた場合は、**cookieCache の有効期間（最大 5 分）だけ反映が遅れる**
  - 現行の JWT（30 日間、サーバーから失効できない。#73-8）よりは大きく改善する
- 有効期限は 30 日、`updateAge` は 1 日（利用中は自動延長）。買い物アプリなので、長めにしてログインの手間を減らす
- 設定画面に「すべての端末からログアウト」を置く（Better Auth の `revokeSessions`）。乗っ取りを疑ったときの最低限の対処
- オフライン時のセッションの扱い（最後にログインしていたユーザーとして閲覧・編集を続ける）は #62 の設計書で扱う。本設計では `AuthContext` に `status: "authenticated" | "unauthenticated" | "loading"` を持たせ、#62 側で `"offline"` を足せる形にしておく

### 7. パスキーの RP ID とプレビュー環境

- WebAuthn は RP ID（ドメイン）に紐づくため、パスキーは**本番ドメインと localhost でのみ有効**にする（`PASSKEY_RP_ID`、`BETTER_AUTH_URL` を環境ごとに設定）
- **本番ドメインを確定してからパスキーを導入する**。`*.vercel.app` で登録したパスキーは、あとで独自ドメインに移ると全部使えなくなる。そのため、パスキーの PR（A5）は「本番ドメインの確定」に依存させる（「## 未確定事項」参照）
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
// 方針イメージ（オプション名・API 名は実装時に公式ドキュメントで再確認すること）
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // 移行期間中は Auth.js のテーブル（sessions / accounts / verification_tokens）と共存させるため、
  // Better Auth のテーブルは別名にする（「### DB スキーマ」参照）
  user: { modelName: "users", fields: { emailVerified: "emailVerifiedFlag" } },
  account: { modelName: "authAccounts" },
  verification: { modelName: "authVerifications" },
  session: {
    modelName: "authSessions",
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
  advanced: {
    database: { generateId: () => crypto.randomUUID() },
    ipAddress: { ipAddressHeaders: ["x-real-ip", "x-vercel-forwarded-for"] }, // Vercel が設定するヘッダだけを使う
  },
  plugins: [
    emailOTP({ otpLength: 6, expiresIn: 300, allowedAttempts: 3, storeOTP: "hashed", sendVerificationOTP }),
    passkey({ rpID, rpName: "買い物メモ", origin, authenticatorSelection: { userVerification: "required" } }),
    nextCookies(), // 必ず最後
  ],
})
```

- tRPC の `createContext` は `auth.api.getSession({ headers: await headers() })` に置き換え、`Context` の型は変えない
- `trustedOrigins` に本番 URL を設定し、Better Auth の Origin 検証を有効のままにする（CSRF 対策）
- OTP 送信の API は、登録済みかどうかに関わらず同じレスポンス・同程度の応答時間を返す（メールアドレスの存在が分からないようにする）。エラーメッセージにも「未登録」などの文言を出さない。送信上限やロックに達したときも、登録の有無に関係なく同じ文言にする
- OTP の保存と照合:
  - `authVerifications` には**ハッシュ化して保存**する（`storeOTP: "hashed"`。既定は平文なので必ず指定する）
  - 照合は定数時間で比較する（ライブラリの実装を確認し、自前の比較は書かない）
  - 成功したらそのコードをすぐ削除する（使い回し不可）。新しいコードを送ったら古いコードは無効にする
- tRPC の mutation でも `Origin` / `Sec-Fetch-Site` を確認し、別オリジンからのリクエストは 403 にする（tRPC の route handler に追加。#71 で指摘された CSRF 対策。Cookie 方式のセッションのまま、SameSite=Lax だけに頼らない）

#### OTP 送信の乱用対策（#72）

Resend の無料枠（100 通/日）を使い切られると、パスキー未登録のユーザーと新規ユーザーが全員ログインできなくなる。総当たりの観点も含めて、次の制限を設ける。

| 制限 | 値 | 目的 |
|------|----|------|
| 再送間隔（メールアドレス単位） | 60 秒 | 連打の防止 |
| 1 日の送信上限（**メールアドレス × IP** 単位） | 5 通 / 24 時間 | 同じ場所からの連続送信と、1 か所あたりの試行回数を抑える（1 日最大 5 コード × 3 回 = 15 回）。キーに IP を含めるので、攻撃者が家族のアドレスを指定しても、**家族自身の端末（別の IP）からの送信は止まらない** |
| 1 日の送信上限（メールアドレス単位・緩い上限） | 20 通 / 24 時間。超えても**完全には止めず、そのアドレスへの送信に対話型の Turnstile チャレンジを必須にする段階**に入り、本人に通知する（下記「ロック時の通知と解除」） | 多数の IP から 1 つのアドレスを狙われた場合の歯止め。止めることで、本人がログインできなくなるのを避ける |
| 送信上限（IP 単位） | 3 通 / 分、20 通 / 24 時間 | 多数のアドレスへの送信を抑える |
| 累積ロック（**メールアドレス × IP** 単位） | 検証の失敗が 24 時間で 10 回に達したら、その「アドレス × IP」からの OTP ログインを 24 時間停止する。**コードを再発行しても失敗回数はリセットしない** | 再発行を繰り返す総当たりの防止。別の IP（家族の端末）からのログインと、パスキーでのログインは止めない |
| 失敗の多いアドレス（メールアドレス単位） | 複数の IP からの検証の失敗が 24 時間で 30 回に達しても、**止めない**。そのアドレスへの送信とコード入力に、対話型の Turnstile チャレンジを必須にする | 多数の IP から 1 つのアドレスを狙われても、本人はチャレンジを通ればログインできる |
| ロック時の通知と解除 | 上記のロック・チャレンジ必須の段階に入ったら、本人のアドレスに通知する（「ログインの試行が繰り返されたため一時的に制限しました。心当たりがなければ問題ありません」。1 日 1 通まで）。本人がパスキーまたは別の IP からの OTP でログインに成功したら、そのアドレスのロック・チャレンジ必須の段階・失敗回数をすべて解除する | 攻撃者に家族のログインを止めさせない。止められても本人が自分で解除できる |
| 全体の送信数の監視 | 1 日の送信数が 70 通を超えたら、管理者にアラートを 1 回送る（ログに警告を出し、管理者のアドレスにメールする） | 枠を使い切る前に気づく |
| ボット対策（**採用決定**） | Cloudflare Turnstile を OTP 送信フォームに常に付け、サーバー側（siteverify）で検証する。通常は操作の要らない非表示モード、上記の上限に達したアドレスでは対話型のチャレンジ（別のウィジェット設定）にする | IP を変えた乱用への防御。上限に達しても止めずにチャレンジに切り替えることで、攻撃者に家族のログインを止めさせない |

- 実装: Better Auth の rateLimit（`storage: "database"`）で IP 単位の制限をかける。メールアドレス（× IP）単位の上限・累積ロック・全体の監視は、送信と失敗を記録する `otp_events` テーブルを作り、Better Auth の `hooks.before`（OTP 送信・OTP サインインのパス）で確認する。ロックの解除は `hooks.after`（サインイン成功時）で行う
- メールアドレスは、環境変数 `OTP_EVENT_HMAC_KEY` を鍵にした HMAC-SHA256 でハッシュ化して保存する（DB が漏れても、アドレスの一覧が分からないようにする）
- `otp_events` の保持期間は **30 日**。判定には直近 24 時間しか使わない。古い行は、書き込みのついでに 1 日 1 回まとめて削除する（定期ジョブを足さない）
- **IP アドレスの取得**: Vercel では、Vercel が設定する `x-real-ip` / `x-vercel-forwarded-for` を使う（`advanced.ipAddress.ipAddressHeaders`）。クライアントが送ってくる `x-forwarded-for` の先頭の値は使わない。偽装したヘッダでは制限のキーが変わらないことをユニットテストで確認する（ヘッダ名と、Vercel が上書きするかどうかは実装時に Vercel のドキュメントで確認する）

#### パスキー経由の乗っ取り対策

- 攻撃者が一度 OTP でログインすると、自分のパスキーを登録して入り続けられる。そこで次の 3 つを入れる
  - パスキーの追加・削除には、**直近 10 分以内のログイン**を要求する（Better Auth の fresh session。古ければコードで再確認する）
  - パスキーを追加・削除したら、**本人のメールアドレスに通知**する（「新しいパスキーが登録されました。心当たりがなければ［すべての端末からログアウト］してください」）
  - 設定画面に「すべての端末からログアウト」を置く（上記「### 6. セッション」）

### DB スキーマ（Drizzle）— expand / contract の 2 段階

本番では、CI の `migrate` ジョブ（main への push で `drizzle-kit migrate` を本番の Neon に実行）と Vercel の本番デプロイが**並行して**進む。そのため、数分間は「旧コード + 新スキーマ」か「新コード + 旧スキーマ」の状態になる。そこでマイグレーションを 2 段階に分け、**どちらの状態でも動くようにする**。

**expand（A2）: 追加だけを行い、Auth.js（旧コード）がそのまま動く状態を保つ**

| テーブル | 変更 |
|---------|------|
| `users` | `email_verified_flag boolean NOT NULL DEFAULT false` を**追加**し、既存の `email_verified`（timestamp）から値を写す（NULL 以外を true）。`name` が NULL の行を `''` に更新する（制約は付けない）。`email` を正規化する（下記）。`email_verified` と `image` は残す（Auth.js が使うため） |
| `auth_sessions`（新規） | Better Auth のセッション（`id`, `token`(unique), `user_id`, `expires_at`, `ip_address`, `user_agent`, `created_at`, `updated_at`） |
| `auth_accounts`（新規） | Better Auth のアカウント（`id`, `account_id`, `provider_id`, `user_id`, `access_token`, `refresh_token`, `id_token`, `access_token_expires_at`, `refresh_token_expires_at`, `scope`, `password`, `created_at`, `updated_at`） |
| `auth_verifications`（新規） | `id`, `identifier`, `value`（OTP のハッシュ）, `expires_at`, `created_at`, `updated_at` |
| `passkeys`（新規） | `id`, `name`, `public_key`, `user_id`(FK cascade), `credential_id`(unique), `counter`, `device_type`, `backed_up`, `transports`, `aaguid`, `created_at` |
| `rate_limits`（新規） | `storage: "database"` 用（`key`, `count`, `last_request`） |
| `otp_events`（新規） | `id`, `email_hash`, `ip`, `kind`（`sent` / `failed` / `locked` / `unlocked`）, `created_at`、インデックス `(email_hash, created_at)` と `(email_hash, ip, created_at)`。保持は 30 日 |
| `sessions`, `accounts`, `verification_tokens` | **変更しない**（Auth.js 用。contract で削除） |

- passkeys テーブルは A2 の expand でまとめて作る（A5 で別のマイグレーションを出すと、リリースの手間が増えるため）
- 正確なカラム定義は `npx @better-auth/cli generate` の出力を元に、`schema.ts` へ手で反映する（CLI に schema.ts を上書きさせない）
- **SQL は手で書く**。`drizzle-kit generate` の出力は下書きとして使い、内容を確認して直す（データの写しや UPDATE は generate では生成されない）
- **メールアドレスの正規化**: マイグレーションの冒頭で、`lower(trim(email))` で重複する行がないかを確認する。重複があれば `RAISE EXCEPTION` で止める（手で解消してから再実行する）。重複がなければ `UPDATE users SET email = lower(trim(email))` を実行する。Google が返すアドレスは小文字なので、通常は変化しない
- 既存の家族の `users` 行と ID はそのまま残る（グループ・アイテム等の外部キーを壊さない）

**contract（A6）: 本番で安定を確認してから（R1b のリリースから 2 週間後を目安）、古いものを削除する**

- `sessions`, `accounts`（Google の連携の行を含む）, `verification_tokens` を DROP する
- `users.email_verified`（timestamp）を DROP し、`users.image` を NULL にする（Google のアバター URL は表示しなくなっている）。`users.name` に `NOT NULL DEFAULT ''` を付ける
- contract の後は、Auth.js のデプロイには戻せない（下記「### ロールバック」）

### accounts テーブルの扱い

- 現在の `accounts` には、既存の家族の Google 連携の行（`provider = 'google'`、アクセストークンやリフレッシュトークンを含む）が入っている
- **expand（A2）では触らない**。Better Auth は別テーブルの `auth_accounts` を使う。そのため、旧デプロイに Promote で戻しても Google ログインがそのまま動く
- Google の行は `auth_accounts` に移さない。Google ログインは廃止するので、トークンを持ち続ける理由がない。メール OTP とパスキーのログインは、`auth_accounts` に行がなくても動く（パスキーは `passkeys` テーブル。OTP はメールアドレスで `users` を引く）。Better Auth が内部で行を作る場合は、それに任せる
- **contract（A6）で `accounts` を DROP する**。同時に Google Cloud Console の OAuth クライアントを削除し、トークンも無効にする

### クライアント

- `src/contexts/AuthContext.tsx`: `next-auth/react` の `SessionProvider` / `useSession` を `authClient.useSession()` に置き換える。`login()` はログイン画面への遷移、`logout()` は `authClient.signOut()` に変更し、#62 のログアウト時データ消去フックを呼べるようにする
- `src/app/login/page.tsx`: メールの入力 → コード入力の 2 段階 UI、パスキーボタン、Conditional UI（`authClient.signIn.passkey({ autoFill: true })`）
- `src/app/onboarding/page.tsx`（新規）: 表示名の設定。`name === ''` のユーザーはここへ誘導する
- `src/components/auth/PasskeyPrompt.tsx`（新規）: 登録を提案するボトムシート
- `src/app/settings/page.tsx`: 「Googleでログイン」を「ログイン」に変更し、アカウント節（表示名・メール・パスキー管理）を追加
- `src/app/groups/page.tsx`: 「Googleでログイン」の文言を変更
- `next.config.ts`: `lh3.googleusercontent.com` の `remotePatterns` を削除

### E2E のログイン

- `E2E_TEST=true` のときだけ有効な Credentials プロバイダは**廃止**する。代わりに E2E では `TestMailboxEmailSender` を使い、`GET /api/test/otp?email=` で直近のコードを取得して、**本物の OTP フローでログイン**する
- **テスト用ルートの有効化条件**（#70。#62 のオフライン E2E と同じ条件にする）
  - **ビルド時**: ルートのファイルを `src/app/api/test/otp/route.e2e.ts` にする。`next.config.ts` の `pageExtensions` には、`E2E_BUILD=true` でビルドしたときだけ `e2e.ts` を加える。Vercel のビルド（Production / Preview）では `E2E_BUILD` を設定しないので、**ルート自体がビルドに含まれない**
  - **実行時**（多重の防御）: `E2E_TEST === "true"` かつ `VERCEL_ENV` が `production` / `preview` ではないこと、かつリクエストヘッダ `x-e2e-token` が `E2E_SEED_TOKEN` と一致すること。どれかが欠けたら 404 を返す
  - **`NODE_ENV` には頼らない**。#62 のオフライン E2E は `next build && next start`（`NODE_ENV=production`）で動かすが、その環境でもログインできる必要があるため
- Playwright の webServer:
  - 通常のプロジェクト: `E2E_BUILD=true E2E_TEST=true next dev`
  - オフラインのプロジェクト（#62）: `E2E_BUILD=true next build && E2E_TEST=true next start`
- `TestMailboxEmailSender` は、コードを **`globalThis` 上の Map** に持つ。DB の OTP はハッシュなので読み戻せない。また、モジュール変数だと Next.js のルートごとのバンドルでインスタンスが分かれるおそれがある。E2E のサーバーは 1 プロセスで動かす
- `e2e/auth/fixtures/auth-helpers.ts` は「OTP 送信 → テスト用ルートからコード取得 → `sign-in/email-otp`」を API 経由で行い、storageState を保存する
- パスキーの E2E は、Chromium の CDP（`WebAuthn.enable` / `WebAuthn.addVirtualAuthenticator`）で仮想認証器を使う（`isUserVerified: true`）

## 影響範囲

| ファイル | 変更 |
|---------|------|
| `package.json` | `next-auth`, `@auth/drizzle-adapter` を削除し、`better-auth`, `@better-auth/passkey`, `resend` を追加 |
| `src/infrastructure/auth/**` | 作り直し（上記） |
| `src/app/api/auth/[...nextauth]/route.ts` | `[...all]/route.ts` に置き換え |
| `src/app/api/test/otp/route.e2e.ts` | 新規（E2E 専用。`E2E_BUILD` のときだけビルドに含める） |
| `.github/workflows/ci.yml` | develop への push で Preview の DB（Neon の develop ブランチ）にもマイグレーションを適用するジョブを追加。E2E のビルドに `E2E_BUILD` / `E2E_SEED_TOKEN` を設定 |
| `src/infrastructure/trpc/server.ts` | `createContext` のセッション取得を変更 |
| `src/infrastructure/db/drizzle/schema.ts` + `migrations/` | 認証テーブルの expand（A2）と contract（A6）。SQL は手で書く |
| `src/contexts/AuthContext.tsx` | Better Auth クライアントに置き換え |
| `src/app/login/page.tsx`, `src/app/onboarding/page.tsx`, `src/components/auth/*` | UI の追加・変更（Turnstile のウィジェットを含む） |
| `src/components/auth/AuthMigrationNotice.tsx` | 新規（切り替え前の告知バナー、A0。A6 で削除） |
| `src/app/settings/page.tsx`, `src/app/groups/page.tsx` | 文言の変更、パスキー管理の追加 |
| `next.config.ts` | Google 画像ドメインの削除 |
| `e2e/auth/**`, `playwright.config.ts` | ログインヘルパーの変更、パスキーの spec を追加 |
| `src/types/next-auth.d.ts`（存在すれば） | 削除 |
| `docs/INFRASTRUCTURE.md`, `AGENTS.md`, Issue #49 | Google OAuth の手順を、Resend のドメイン設定と環境変数の手順に置き換え |

環境変数:

| 削除 | 追加 |
|------|------|
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET`（`AUTH_SECRET`）, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`（**A6 の contract まで残す**。それまでは旧デプロイへの Promote で Google ログインが動く必要があるため） | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `PASSKEY_RP_ID`, `NEXT_PUBLIC_PASSKEY_ENABLED`, `OTP_ALERT_EMAIL`、`OTP_EVENT_HMAC_KEY`、`EMAIL_RECIPIENT_ALLOWLIST`（Preview のみ）、`TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY`。E2E 用の `E2E_BUILD` / `E2E_TEST` / `E2E_SEED_TOKEN` は CI とローカルだけで使い、Vercel には**設定しない** |

## 既存ユーザーの移行

対象は本番の 1 家族だけである。ユーザーの判断により、**Google との併用期間は設けず、一括で切り替える**（Issue #61 にも「一括切り替え、併用期間なし」と記載）。併用しない理由は次のとおり。

- 対象が 1 家族で、個別に連絡して 1 回再ログインしてもらえば済む
- 併用すると、移行期間中に Google 側のアカウント連携と OTP の紐付けを両方保守する必要があり、テストも倍になる
- expand / contract で DB を戻さずに旧デプロイへ戻せるので、切り替えに失敗しても Google ログインに即時に戻れる

**紐付けの方法**: 同じメールアドレスなら、既存の `users` 行に紐付ける。Google ログイン時に保存された Gmail アドレスが `users.email` に入っているので、そのアドレスで OTP ログインすれば同じ `users.id` になる。グループ・アイテム・リスト・履歴はそのまま見える。

**手順**

1. **切り替え前の告知**（R0）: ログイン中の画面に告知バナーを出す（A0）。「○月○日からログイン方法が変わります。Google の代わりに、Gmail アドレスに届くコードでログインします」。あわせて家族に直接も連絡する
2. 切り替え（R1b）。旧 Auth.js のセッション（JWT Cookie）は読めなくなり、家族の端末はログアウト状態になる。ログイン画面に「ログイン方法が変わりました。以前 Google で使っていた Gmail アドレスを入力してください」という案内を出す（A6 で削除）
3. 家族がそれぞれの端末で、Gmail アドレス + コードでログインする → 同じデータが見えることを確認する
4. パスキーのリリース（R2）後、ログイン後の提案から各端末でパスキーを登録してもらう。**これで移行は完了**
5. R1b から 2 週間問題がなければ、contract（R3）で旧テーブルを削除し、Google の OAuth クライアントと環境変数を削除する

- ゲストモードの IndexedDB のデータは端末内に残るので、影響はない
- 切り替え前の Google ログイン中は tRPC を直接呼んでいたので、端末内に未送信のデータはない（#62 のローカルファースト化より前に切り替える前提）

## 本番環境への影響とリリース手順

### 本番への影響

| 項目 | 影響 |
|------|------|
| 既存の家族 | 切り替え（R1b）で 1 回ログアウトされ、メールのコードで再ログインが必要。データは失われない |
| DB | R1a で追加だけのマイグレーション（expand）を行う。旧テーブルの削除（contract）は R3 で行う |
| 環境変数（Vercel Production / Preview） | R1a より前に Better Auth / Resend の変数を追加する。Google の変数は R3 まで残す |
| 外部サービス | Resend のアカウントと、送信ドメインの DNS（SPF / DKIM）。DNS の反映待ちがあるので R1a より前に済ませる（**送信元の独自ドメインが前提**。「未確定事項 1」）。Turnstile のサイトキー（非表示用と対話型用）とシークレットを用意する |
| Preview 環境 | Preview は本番とは**別の DB**（Neon の develop ブランチ）を使う。develop へのマージで自動デプロイされるが、マイグレーションは自動では適用されない。そこで A2 で CI に「develop への push で Preview の DB にマイグレーションを適用する」ジョブを追加する（それまでは、PR をマージした人が `DATABASE_URL=<Preview の URL> npm run db:migrate` を手で実行する）。メールは実際に送られるので、Preview でも Resend を使う。Preview の URL は公開されていて、本番と同じ Resend の枠（100 通/日）を使ってしまうため、**Preview では送信先を許可リストに限定する**（環境変数 `EMAIL_RECIPIENT_ALLOWLIST` に自分と家族のアドレス。リストにないアドレスには送らず、レスポンスは同じにする）。あわせて Vercel の Deployment Protection（Vercel Authentication）で Preview を保護する。`E2E_BUILD` / `E2E_TEST` は Preview に**設定しない**（#70） |
| デプロイとマイグレーションの順序 | CI の `migrate` ジョブ（main への push で本番 DB に適用）と Vercel の本番デプロイは**並行して**進む。そのため、マイグレーション（R1a）と、それを使うコード（R1b）を**別々のリリース**にする。R1a の時点では旧コードのまま新しいテーブルが増えるだけで、R1b の時点ではテーブルがすでにある |

### リリース手順（develop → main）

**本番（main）へは、develop の内容をユーザーが Vercel Preview で確認し、OK を出してからマージする。**

```
develop に PR をマージ
  → Vercel が Preview に自動デプロイ ＋ CI が Preview の DB にマイグレーション（A2 以降）
  → ユーザーが Preview で「確認チェックリスト」を実施
  → OK → develop → main の PR をマージ → 本番デプロイ ＋ 本番 DB にマイグレーション
  → NG → develop で修正して、Preview の確認からやり直す
```

| リリース | 含める PR | 内容 |
|---------|----------|------|
| R0 | #65（依存パッケージの更新）、#67（招待コード対策）、#70、#72 の該当分、A0（告知バナー） | 認証移行の前提になるセキュリティ修正（Issue #61 の依存）と、切り替え前の告知 |
| R1a | A1 + A2（メール送信基盤、expand マイグレーション、Preview の DB へのマイグレーションジョブ） | 本番では Auth.js のまま動き、新しいテーブルが増えるだけ |
| R1b | A3 + A4（Better Auth への切り替え、OTP ログイン、表示名の設定） | **一括切り替え**。家族が使わない時間帯に main へマージする |
| R2 | A5（パスキー） | 本番ドメインの確定が前提。家族にパスキーを登録してもらう |
| R3 | A6（contract、ドキュメント） | R1b から 2 週間問題がなければ出す。Google の OAuth クライアントと環境変数を削除する |

#### Preview での確認チェックリスト（ユーザーが実施）

Preview の URL は、develop ブランチの固定 URL（`shopping-memos-git-develop-<team>.vercel.app`）を使う。Preview の DB には、本番相当のテストデータ（Google で作られた形の `users` / `accounts` 行、グループ、アイテム）を用意しておく（A2 の PR で用意する手順を書く）。

**R0**
- [ ] Google でログインできる（従来どおり）
- [ ] ログイン中の画面に告知バナーが出て、閉じると再表示されない
- [ ] グループへの参加（招待コード）が従来どおりできる。誤ったコードを続けて入れると制限される（#67）
- [ ] アイテムの追加・リスト作成・買い物完了・履歴が従来どおり動く

**R1a**
- [ ] Preview の DB にマイグレーションが適用されている（CI のジョブが成功している）
- [ ] Google でログインでき、既存のデータが見える（旧コードのまま動く）
- [ ] アイテム・リスト・グループの操作が従来どおり動く

**R1b**
- [ ] ログイン画面に Google のボタンがなく、移行の案内が出る
- [ ] 既存ユーザーの Gmail アドレス（許可リストに入れたもの）にコードが届き、ログインできる
- [ ] ログイン後、既存のグループ・アイテム・リスト・履歴がそのまま見える（同じユーザーとして紐付いている）
- [ ] 表示名の設定画面は、既存ユーザーには出ない。新しいアドレスでログインすると出る（この確認用に、テスト用の新しいアドレスを Preview の `EMAIL_RECIPIENT_ALLOWLIST` に入れておく）
- [ ] 誤ったコードを 3 回入れると無効になり、再送できる。再送ボタンは 60 秒間押せない
- [ ] ログアウトするとゲストモードに戻る。「すべての端末からログアウト」で、別の端末も（最大 5 分で）ログアウトされる
- [ ] iPhone のホーム画面に追加した状態でも、コード入力でログインが完結する
- [ ] 許可リスト外のアドレスでは、メールが届かない（画面の表示は同じ）

**R2**
- [ ] ※ パスキーは本番ドメインでしか有効にしないため、Preview ではパスキーの UI が出ないことだけを確認する
- [ ] Preview でパスキーのボタン・登録の提案・設定のパスキー欄が表示されない
- [ ] 本番のリリース直後に、自分の端末で「パスキーを登録 → ログアウト → パスキーでログイン → 設定で削除」を確認する（本番でのチェック項目）

**R3**
- [ ] Preview の DB に contract が適用された後も、OTP ログインと既存データの表示ができる
- [ ] 設定・グループの画面に Google の文言・アバターが残っていない

#### 各リリースの共通手順

実施者: Preview の確認と main へのマージの判断はユーザー本人。Claude は PR の作成、チェックリストの準備、CI の確認まで。

1. develop と main の差分を確認する（`git log origin/main..origin/develop`）。対象外の未リリースのコミットがあれば、先に別のリリースとして出す
2. develop への PR をマージし、Preview の自動デプロイと、Preview の DB へのマイグレーション（A2 以降の CI ジョブ。A2 より前は `DATABASE_URL=<Preview の URL> npm run db:migrate` を手動で実行）の完了を確認する
3. **ユーザーが Preview で上のチェックリストを実施する。すべて OK になるまで main へは進まない**
4. Neon で本番ブランチのバックアップ（`backup-before-r1a` など）を作る（最後の手段の保険）
5. develop → main の PR を作り、CI（lint / test / build / E2E）が通ることを確認してマージする
6. CI の `migrate` ジョブの成功と、Vercel の本番デプロイの完了を確認する
7. 本番で、自分のアカウントで動作を確認し、家族に案内する

### ロールバック

| 時点 | 戻し方 | データ |
|------|-------|-------|
| R1a の後 | Vercel で 1 つ前の本番デプロイを Promote する（追加したテーブルは残しても旧コードに影響しない） | 失われない |
| R1b の後、R3 の前 | Vercel で R1a のデプロイを Promote する → Auth.js と Google ログインに戻る。**DB は戻さない**（旧テーブルと `users` の旧列は残っている）。Google の環境変数も残っているので、そのまま動く。家族には Google で再ログインしてもらう | 失われない（R1b 以降の書き込みも同じ `users` / 業務テーブルに入っている）。OTP のセッションとパスキーは使われなくなるだけ |
| R3（contract）の後 | Auth.js には戻せない。**修正版を前進デプロイして直す** | — |
| 最後の手段 | Neon のバックアップブランチを本番に戻す | **バックアップ以降に書き込まれたデータ（アイテムの追加、グループの参加など）は失われる**。家族に再入力を頼む必要があるため、上の手順で戻せない場合に限る |

- 判断の目安: R1b のリリース後 30 分以内に自分のアカウントで OTP ログインできない、または 500 エラーが続く場合は、R1a のデプロイに Promote で戻す

## 実装ステップ（1 ステップ = 1 PR、500 行以下目安）

依存順は「→」で表す。並行実装はしない（`.claude/rules/task-management.md`）。

| # | PR | 主な内容 | 依存 | 規模目安 |
|---|----|---------|------|---------|
| A0 | `feat: 認証方式の変更を告知するバナーを追加` | ログイン中のユーザーに出す告知バナー（閉じたら localStorage に記録）、日付は定数 | #65, #67, #70, #72 | ~80 |
| A1 | `feat: メール送信基盤（EmailSender/Resend）を追加` | `EmailSender` インターフェース、Resend / Console / TestMailbox（`globalThis`）の実装、OTP とパスキー通知のメールテンプレート、メールアドレスの正規化、環境変数の検証（Zod） | A0、**送信元ドメインの確定** | ~300 |
| A2 | `feat: Better Auth 用テーブルを追加（expand マイグレーション）` | `schema.ts` への追加、手書きの SQL（重複の確認、正規化、`email_verified_flag` への写し）、Preview の DB へのマイグレーションジョブ（ci.yml）、マイグレーションのテスト | A1 | ~250（SQL を除く） |
| A3 | `feat: Better Auth に切り替えメールOTP認証を導入` | Better Auth 本体（emailOTP・rateLimit・cookieCache・IP ヘッダ）、OTP 乱用対策（`otp_events`、送信上限、累積ロック、全体の監視）、`[...all]` ルート、tRPC context と Origin の確認、`AuthContext` の置き換え、ログイン画面の OTP UI（2 段階）と移行の案内、E2E のテスト用ルート（`route.e2e.ts`）とログインヘルパー、Credentials プロバイダと next-auth の削除 | A2 | ~500 |
| A4 | `feat: 初回ログイン時の表示名設定を追加` | `/onboarding`、`name === ''` のときの誘導、`identity.updateProfile`、設定画面のアカウント節（表示名・メール・すべての端末からログアウト） | A3 | ~300 |
| A5 | `feat: パスキーの登録・ログイン・管理を追加` | passkey プラグイン（`userVerification: "required"`）、ログイン画面のパスキーボタンと Conditional UI、登録提案のボトムシート、設定画面のパスキー一覧・追加・削除（fresh session を要求）、追加・削除時のメール通知、プレビュー環境での無効化 | A4、**本番ドメインの確定** | ~450 |
| A6 | `chore: 旧認証テーブルを削除しGoogle関連を撤去（contract）` | contract のマイグレーション、`next.config.ts` の Google 画像ドメインの削除、移行の案内と告知バナーの削除、`docs/INFRASTRUCTURE.md` / `AGENTS.md`（Prisma → Drizzle の記述修正も含む）/ `.env.example` の更新、#49 の本文更新 | A5、R1b から 2 週間 | ~250 |

- A3 が 500 行を超えそうなら、「A3a: サーバー側の切り替え（ログイン画面は最小限のフォーム）」と「A3b: OTP 乱用対策とログイン画面の仕上げ」に分ける。ただし、**A3b がマージされるまで develop から main へは出さない**（乱用対策なしで本番に出さない）
- Turnstile は A3 に含める（ウィジェット、サーバー側の検証、チャレンジの段階の切り替え、CSP の調整）。Preview と E2E では Cloudflare のテスト用サイトキー（常に成功するもの）を使う
- #62（オフライン）の「オフライン時のセッション保持」ステップ（O9）は、A3 に依存する

## テスト計画

### ユニット（Vitest）

| 対象 | テスト内容 |
|------|-----------|
| 送信先の許可リスト | `EMAIL_RECIPIENT_ALLOWLIST` が設定されていると、リスト外のアドレスには送らず、レスポンスは送信時と同じ。本番（未設定）では制限しない |
| `EmailSender` 各実装 | Resend SDK をモックし、宛先・件名・本文（コード・有効期限を含み、URL を含まない）を検証。送信失敗時に例外を正しく伝えること |
| OTP メールテンプレート | 日本語の本文、コードの桁数、HTML エスケープ |
| 環境変数の検証 | 本番で `RESEND_API_KEY` / `BETTER_AUTH_SECRET` が欠けていたら起動時エラー、開発時は Console 送信にフォールバック |
| `/api/test/otp` ルート | `E2E_TEST` が未設定、`VERCEL_ENV` が production / preview、`x-e2e-token` が不一致・なし、のそれぞれで 404。条件がそろったときだけ直近のコードを返す。`NODE_ENV=production` でも条件がそろえば応答する（オフライン E2E 用） |
| `pageExtensions` の設定 | `E2E_BUILD` が未設定なら `e2e.ts` を含まない |
| OTP 乱用対策 | 再送間隔 60 秒、「アドレス × IP」あたり 5 通/日、IP あたり 3 通/分・20 通/日の各上限で拒否する。Turnstile の検証に失敗した送信は拒否される。アドレスあたり 20 通、または複数 IP から 30 回の失敗に達すると、対話型チャレンジ必須の段階に入り、完全には止まらない。「アドレス × IP」で累積 10 回失敗するとロックし、再発行してもリセットされない。**別の IP からは同じアドレスで送信・ログインできる**。ロック時に本人へ通知が 1 日 1 通だけ送られ、パスキーまたは別 IP からの成功でロックが解除される。1 日 70 通を超えたらアラートを 1 回だけ送る。30 日より古い `otp_events` が削除される |
| 列挙対策 | 登録済み・未登録・上限到達・ロック中のアドレスで、OTP 送信のレスポンス（ステータス・本文）が同じ |
| IP の取得 | 設定したヘッダ（`x-real-ip` 等）だけを使い、クライアントが付けた `x-forwarded-for` を変えても制限のキーが変わらない |
| OTP の保存 | DB にはハッシュだけが入り、平文のコードが残らない。使用後に削除される |
| パスキーの追加・削除 | ログインから 10 分を超えたセッションでは拒否される。成功時に通知メールが送られる |
| tRPC `createContext` | セッションあり → `userId` を設定、なし → undefined。`protectedProcedure` が 401 を返す |
| マイグレーション（DB を使うテスト。E2E と同じ Postgres で実行） | 現行のスキーマ（0000〜0003）に、Google ユーザー（`users`・`accounts`・`email_verified` が timestamp・大文字を含む email）とグループ・アイテムのデータを入れる → expand を適用 → `users` の行と ID が残り、`email_verified_flag` が写され、email が小文字になり、旧テーブルが残っている。正規化後に重複するデータでは、マイグレーションが失敗する。contract を適用すると旧テーブルと旧列が消える |
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
| L-9 | 同じブラウザから同じメールアドレスに 6 回目の送信をすると、上限の文言（未登録の場合と同じ）が出る。別のコンテキスト（別 IP を模したヘッダ）からは送信できる |
| L-10 | 旧デプロイへの互換: expand を適用した DB で、旧コード（現在の main）の E2E（Credentials ログイン・グループ共有）が全件パスする。CI で 1 回だけ実行し、結果を PR に記録する |
| L-8 | 既存ユーザーの移行: Google ログインで作られた想定の `users` 行（name・Gmail アドレスあり）とグループ・アイテムを seed → 同じアドレスで OTP ログイン → 同じ `users.id` で既存データが見え、表示名の設定画面が出ない |

## セキュリティ

- OTP の総当たり対策: 試行 3 回で無効化、5 分で失効、「メールアドレス × IP」ごとの 1 日の送信上限と累積ロック（攻撃者が家族のアドレスを指定しても、家族のログインは止まらない。ロック時は本人に通知し、ログイン成功で解除）、IP ごとのレート制限（「#### OTP 送信の乱用対策」）
- メールアドレスの列挙対策: OTP 送信の結果を登録有無で変えない
- CSRF: Better Auth の Origin 検証と `trustedOrigins`、Cookie は `Secure` / `HttpOnly` / `SameSite=Lax`
- パスキー: `userVerification: "required"`（パスキーだけでログインが完結するため、PIN や生体認証のないセキュリティキーの「持っているだけ」のログインを許さない）。署名カウンタの検証はライブラリに任せる。RP ID は環境変数で固定し、リクエストの Host ヘッダから決めない
- E2E 用のテストルートは、ビルド時の除外（`E2E_BUILD` のときだけ `pageExtensions` に含める）と、実行時の多重条件（`E2E_TEST`・`VERCEL_ENV`・共有シークレット）で守る（「### E2E のログイン」）
- OTP はハッシュ化して保存し、照合は定数時間、使用後はすぐ無効にする
- **メールアドレスの正規化**（#65 で指摘された Auth.js のホモグリフ問題を、移行後に再発させない）: 送信・照合の前に「Unicode 正規化（NFKC）→ trim・小文字化 → 形式の検証（Zod）」の順に行う。ASCII 以外を含むアドレス（IDN を含む）は当面拒否する。正規化後の値で `users.email` を一意にする

### セキュリティ Issue との対応

| Issue | 内容 | 本設計での扱い |
|-------|------|---------------|
| #65 | next-auth / @auth/core / Next.js の既知脆弱性 | **A3 で next-auth を削除するため、Auth.js 側は解消する**。ただし、それまでに時間がかかるのと、ロールバック先（R1a のデプロイ）も Auth.js なので、#65 の依存更新（next-auth beta.32 以上、Next.js 16.4.x 以上）は**本 Issue より先に**行う（R0）。メール正規化は上記で対応 |
| #70 | `E2E_TEST` の環境変数 1 つでパスワードなしログインが有効になる | **A3 で Credentials プロバイダを削除する**。代わりの `/api/test/otp` は、`E2E_BUILD` のときだけビルドに含め、実行時も `E2E_TEST`・`VERCEL_ENV`・`E2E_SEED_TOKEN` ヘッダで守る（`NODE_ENV` には頼らない。#62 のオフライン E2E を本番ビルドで動かすため）。`/api/e2e/seed` の修正は #70 側で行う |
| #67 | 招待コードを総当たりで推測できる | メール認証でアカウントを量産しやすくなると悪化する。**切り替えより前（R0）に #67 を本番へ出す** |
| #72 | レート制限がない | 認証系のエンドポイントは、Better Auth の rateLimit（IP 単位）と、`otp_events` による「メールアドレス × IP」単位の上限・累積ロックで、A3 から制限する。#72 で Upstash Redis などを導入する場合は、Better Auth の `secondaryStorage` を同じ Redis に向け、`storage: "secondary-storage"` に切り替える |
| #73-8 | JWT セッションを個別に失効できない | **DB セッションに変えることで解消する**。設定画面に「すべての端末からログアウト」を置く（A4）。cookieCache により、他の端末への反映は最大 5 分遅れる |
| #71 | セキュリティヘッダがない。tRPC で Origin を確認していない | A3 で tRPC mutation の `Origin` / `Sec-Fetch-Site` 確認を入れる。Better Auth の `trustedOrigins` には本番 URL だけを設定する（Preview は環境変数で追加する）。#71 で Permissions-Policy を入れる際、`publickey-credentials-get` / `publickey-credentials-create` を `self` で許可する（塞ぐとパスキーが動かない） |

## 考慮事項

- **iOS PWA**: 標準モードの PWA でもパスキー（Face ID）は使える。メールアプリから戻る際にアプリ切り替えが必要になるが、コード方式なので入力して完結する
- **Conditional UI 非対応ブラウザ**: パスキーボタンを明示的に置いているので問題ない。`PublicKeyCredential` がない環境ではボタンを出さない
- **共有端末**: パスキーは端末に保存されるため、共有端末では登録の提案を「あとで」にできる
- **既存データ**: ユーザー・グループは残る（`users.id` を維持）。同じメールアドレスで OTP ログインすれば、そのままグループに参加した状態になる
- **家族が Gmail 以外のアドレスに変えたい場合**: メールアドレスの変更機能は対象外。必要なら、リリース前に DB の `users.email` を手で更新する（1 家族なので手作業で足りる）
- **ゲストデータのマージ**: 既存の `DataMergeContext`（ログイン時に `trpc.sync.merge` を呼ぶ）は、セッション取得部分が `AuthContext` 経由なので動作は変わらない。E2E の L-1 / L-2 で回帰を確認する
- **メールが届かない**: 迷惑メールフォルダの案内を表示する。Resend のダッシュボードで送信ログを確認できる
- **AGENTS.md の記述が古い**（Prisma / next-pwa と書かれている）ので、A6 で直す
- **Resend の枠が尽きた場合**: パスキー登録済みのユーザーはログインできる。家族にはパスキーの登録を早めに勧める。枠を使い切られそうな日は、管理者のアラートを見て、上限の見直しや Turnstile を常に対話型にする設定を検討する

## 決定事項（2026-11-16 ユーザー承認）

| # | 項目 | 決定 |
|---|------|------|
| 1 | 認証ライブラリ | Auth.js から **Better Auth** に移行する |
| 2 | メール認証方式 | **6 桁のワンタイムコード（OTP）**。マジックリンクは使わない |
| 3 | メール送信サービス | **Resend**（承認済み）。送信元は `noreply@mail.counoco.net`（下記「決定事項 8」） |
| 8 | 独自ドメイン | ユーザー所有の **`counoco.net`（Cloudflare DNS）** を使う。本番アプリは **`shopping.counoco.net`**（Vercel のカスタムドメイン、Cloudflare は DNS only の CNAME）。パスキーの RP ID も `shopping.counoco.net`。メール送信は **`mail.counoco.net`** サブドメインを Resend で検証（SPF / DKIM / DMARC を Cloudflare に登録）し、ルートドメインの評判と分離する。`shopping-memos.vercel.app` は `shopping.counoco.net` へリダイレクトする（A5 より前に切り替え、既存の Google ログインのリダイレクト URI にも新ドメインを追加） |
| 7 | ボット対策 | **Cloudflare Turnstile を採用**する（A3 に含める）。OTP の送信上限に達しても止めずに、対話型のチャレンジ必須に切り替える |
| 4 | パスキーの位置づけ・復旧 | パスキーは**任意**（ログイン後に登録を提案）。復旧手段はメールのコード。Vercel のプレビュー環境ではパスキーを無効にする |
| 5 | 表示名 | 初回ログイン時に**表示名の入力を必須**にする |
| 6 | 既存ユーザーの移行 | 本番の Google ユーザーは **1 家族のみ**。**併用期間なしの一括切り替え**で、同じメールアドレスなら既存の `users` 行に紐付け、1 回の再ログインで移行する |

## 未確定事項（実装前に確認する）

設計レビューで新たに出た項目。上の決定事項とは別に、該当する PR の着手前に決める。

1. **【解決済み】独自ドメイン**: `counoco.net` を使う（決定事項 8）。R1a より前に、ユーザー作業として次を行う
   - Vercel に `shopping.counoco.net` を追加し、Cloudflare に CNAME（`cname.vercel-dns.com`、プロキシ OFF）を登録
   - Resend に `mail.counoco.net` を追加し、表示される SPF / DKIM レコードと DMARC（`p=none` から開始）を Cloudflare に登録
   - Turnstile のウィジェットを `shopping.counoco.net` と Preview 用ホストで作成
