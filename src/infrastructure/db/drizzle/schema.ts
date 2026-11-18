import {
  pgTable,
  text,
  integer,
  boolean,
  bigint,
  check,
  timestamp,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

/**
 * 同期用の列（#62 O3。docs/features/offline-support.md「## 実装方針」）
 * - updatedAt: サーバーの書き込み時刻。pull のカーソル専用（LWW の判定には使わない）
 * - fieldModifiedAt: フィールド名 → 最後に適用した操作時刻（補正済みの ISO 文字列）。LWW の判定専用
 * - deletedAt: 論理削除（tombstone）の時刻
 */
const syncColumns = () => ({
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  fieldModifiedAt: jsonb("field_modified_at")
    .$type<Record<string, string>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  deletedAt: timestamp("deleted_at"),
})

// ============================================================
// Identity コンテキスト
// ============================================================

/**
 * ユーザー
 * NextAuthから同期
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  // Auth.js 用（timestamp）。contract（#61 A6）で削除する
  emailVerified: timestamp("email_verified"),
  // Better Auth 用（boolean。#61 A2 の expand で追加し、email_verified から写した）
  emailVerifiedFlag: boolean("email_verified_flag").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

/**
 * アカウント（OAuth連携）
 * NextAuth用 - @auth/drizzle-adapterが期待するカラム名を使用
 */
export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })]
)

/**
 * セッション
 * NextAuth用
 */
export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires").notNull(),
})

/**
 * 検証トークン
 * NextAuth用（メール認証など）
 */
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires").notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })]
)

// ------------------------------------------------------------
// Better Auth（#61。docs/features/passkey-email-auth.md の「### DB スキーマ」）
// A2 の expand で追加。移行の間は Auth.js のテーブル（accounts / sessions / verification_tokens）と
// 共存させるため、別の名前にする。key は Better Auth のフィールド名に合わせる（drizzleAdapter が key で引く）
// ------------------------------------------------------------

/** Better Auth のセッション（データベースセッション） */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("auth_sessions_user_idx").on(table.userId)]
)

/** Better Auth のアカウント（ログイン方法ごとの行） */
export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("auth_accounts_user_idx").on(table.userId)]
)

/** Better Auth の検証（メールの OTP。value はハッシュ） */
export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)]
)

/** パスキー（@better-auth/passkey。A5 で使う） */
export const passkeys = pgTable(
  "passkeys",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull().unique(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    aaguid: text("aaguid"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("passkeys_user_idx").on(table.userId)]
)

/** Better Auth のレート制限（storage: "database"。サーバーレスでメモリを共有できないため） */
export const rateLimits = pgTable("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
})

/**
 * OTP の送信・照合・制限の記録（#72。設計書「#### OTP 送信の乱用対策」、61-a3 の design の D4）
 * - email_hash: OTP_EVENT_HMAC_KEY を鍵にした HMAC-SHA256。管理者への知らせ（alerted）だけは特定のアドレスに結びつかないので NULL
 * - ip: IP が取れないときは固定の値 'unknown'（NULL にすると (email_hash, ip) の照合が効かない）
 * - kind: sent（送信）/ attempted（照合の前に記録）/ locked / unlocked / notified（本人への制限の通知）/ alerted（管理者への知らせ）
 * 判定には直近 24 時間、保持は 30 日
 */
export const otpEvents = pgTable(
  "otp_events",
  {
    id: text("id").primaryKey(),
    emailHash: text("email_hash"),
    ip: text("ip").notNull(),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("otp_events_email_kind_created_idx").on(table.emailHash, table.kind, table.createdAt),
    index("otp_events_email_ip_kind_created_idx").on(
      table.emailHash,
      table.ip,
      table.kind,
      table.createdAt
    ),
    // 全体の送信数の監視と、古い行の削除に使う
    index("otp_events_kind_created_idx").on(table.kind, table.createdAt),
    check(
      "otp_events_kind_check",
      sql`${table.kind} in ('sent', 'attempted', 'locked', 'unlocked', 'notified', 'alerted')`
    ),
    check("otp_events_email_hash_check", sql`${table.kind} = 'alerted' or ${table.emailHash} is not null`),
  ]
)

/**
 * グループ
 * 共有単位
 */
export const groups = pgTable(
  "groups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    inviteCode: text("invite_code").notNull().unique(), // 8文字の招待コード（旧形式は6文字）
    inviteEnabled: boolean("invite_enabled").default(true).notNull(),
    // 招待コードの有効期限。アプリは発行時に明示的に設定する。
    // DB の既定値は、既存行と旧バージョンのアプリが作るグループ用（後方互換）
    inviteCodeExpiresAt: timestamp("invite_code_expires_at")
      .default(sql`now() + interval '7 days'`)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("groups_invite_code_idx").on(table.inviteCode)]
)

/**
 * グループメンバー
 * 役割: owner（管理者）、member（一般）
 */
export const groupMembers = pgTable(
  "group_members",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // 'owner' | 'member'
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("group_members_group_user_idx").on(table.groupId, table.userId)]
)

/**
 * 招待リンク
 * 7日有効、1回限り使用可能
 */
export const inviteLinks = pgTable(
  "invite_links",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    usedBy: text("used_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("invite_links_group_idx").on(table.groupId)]
)

/**
 * 招待コードによる参加の試行履歴
 * ユーザーごとの試行回数制限（総当たり対策）に使う
 */
export const inviteCodeAttempts = pgTable(
  "invite_code_attempts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
  },
  (table) => [
    index("invite_code_attempts_user_attempted_idx").on(table.userId, table.attemptedAt),
  ]
)

// ============================================================
// Catalog コンテキスト
// ============================================================

/**
 * アイテム（買いたいもの）
 * userId: 作成者（必須）
 * groupId: グループ（オプション、nullなら個人アイテム）
 */
export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    memo: text("memo"),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    groupId: text("group_id").references(() => groups.id, { onDelete: "set null" }),
    purchasedAt: timestamp("purchased_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    ...syncColumns(),
  },
  (table) => [
    index("items_user_idx").on(table.userId),
    index("items_group_idx").on(table.groupId),
    index("items_purchased_idx").on(table.purchasedAt),
    index("items_group_updated_idx").on(table.groupId, table.updatedAt),
    index("items_user_updated_idx").on(table.userId, table.updatedAt),
  ]
)

/**
 * タグ
 * アイテムの分類用
 * userId: 作成者（必須）
 * groupId: グループ（オプション、nullなら個人タグ）
 */
export const tags = pgTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    groupId: text("group_id").references(() => groups.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    ...syncColumns(),
  },
  (table) => [
    index("tags_user_idx").on(table.userId),
    index("tags_group_idx").on(table.groupId),
    index("tags_group_updated_idx").on(table.groupId, table.updatedAt),
    index("tags_user_updated_idx").on(table.userId, table.updatedAt),
  ]
)

/**
 * アイテムとタグの中間テーブル
 */
export const itemTags = pgTable(
  "item_tags",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.tagId] })]
)

// ============================================================
// Shopping コンテキスト
// ============================================================

/**
 * 買い物リスト
 * ステータス: in_progress（進行中）、completed（完了）
 * userId: 作成者（必須）
 * groupId: グループ（オプション、nullなら個人リスト）
 * purchasedAt: 購入日時（入っていれば購入履歴として表示）
 */
export const shoppingLists = pgTable(
  "shopping_lists",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("in_progress"), // 'in_progress' | 'completed'
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    groupId: text("group_id").references(() => groups.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    purchasedAt: timestamp("purchased_at"), // 購入日時（購入履歴として表示）
    location: text("location"), // 購入場所
    ...syncColumns(),
  },
  (table) => [
    index("shopping_lists_user_idx").on(table.userId),
    index("shopping_lists_group_idx").on(table.groupId),
    index("shopping_lists_status_idx").on(table.status),
    index("shopping_lists_purchased_idx").on(table.purchasedAt),
    index("shopping_lists_group_updated_idx").on(table.groupId, table.updatedAt),
    index("shopping_lists_user_updated_idx").on(table.userId, table.updatedAt),
  ]
)

/**
 * リスト内アイテム
 * Catalog.Itemのスナップショット
 * userId: 作成者（必須）
 */
export const listItems = pgTable(
  "list_items",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    memo: text("memo"),
    tagIds: text("tag_ids").array(), // スナップショット（正規化しない）
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    groupId: text("group_id"),
    checked: boolean("checked").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    ...syncColumns(),
  },
  (table) => [
    index("list_items_list_idx").on(table.listId),
    index("list_items_user_idx").on(table.userId),
    index("list_items_group_updated_idx").on(table.groupId, table.updatedAt),
    index("list_items_user_updated_idx").on(table.userId, table.updatedAt),
  ]
)

// purchase_history テーブルは廃止
// 購入履歴は shopping_lists.purchased_at が入っているレコードとして表示

// ============================================================
// 同期エンジン
// ============================================================

/**
 * 同期操作ログ
 * クライアントからの同期操作を記録
 */
export const syncOperations = pgTable(
  "sync_operations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    entity: text("entity").notNull(), // 'item' | 'tag' | 'list' | 'listItem' | 'history'
    entityId: text("entity_id").notNull(),
    operation: text("operation").notNull(), // 'create' | 'update' | 'delete'
    payload: text("payload").notNull(), // JSON文字列
    localId: text("local_id"), // ローカルUUID（マージ時のマッピング用）
    syncedAt: timestamp("synced_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("sync_operations_user_idx").on(table.userId, table.syncedAt),
    index("sync_operations_entity_idx").on(table.entity, table.entityId),
  ]
)
