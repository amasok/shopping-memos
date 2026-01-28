import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"

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
  emailVerified: timestamp("email_verified"),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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

/**
 * グループ
 * 共有単位
 */
export const groups = pgTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

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

// ============================================================
// Catalog コンテキスト
// ============================================================

/**
 * アイテム（買いたいもの）
 */
export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    memo: text("memo"),
    groupId: text("group_id").references(() => groups.id, { onDelete: "set null" }),
    purchasedAt: timestamp("purchased_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("items_group_idx").on(table.groupId),
    index("items_purchased_idx").on(table.purchasedAt),
  ]
)

/**
 * タグ
 * アイテムの分類用
 */
export const tags = pgTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    groupId: text("group_id").references(() => groups.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("tags_group_idx").on(table.groupId)]
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
 */
export const shoppingLists = pgTable(
  "shopping_lists",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("in_progress"), // 'in_progress' | 'completed'
    groupId: text("group_id").references(() => groups.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("shopping_lists_group_idx").on(table.groupId),
    index("shopping_lists_status_idx").on(table.status),
  ]
)

/**
 * リスト内アイテム
 * Catalog.Itemのスナップショット
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
    groupId: text("group_id"),
    checked: boolean("checked").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("list_items_list_idx").on(table.listId)]
)

/**
 * 購入履歴
 */
export const purchaseHistory = pgTable(
  "purchase_history",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .unique()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    location: text("location"),
    itemIds: text("item_ids").array(), // 購入したアイテムのID
    groupId: text("group_id"),
    purchasedAt: timestamp("purchased_at").defaultNow().notNull(),
  },
  (table) => [
    index("purchase_history_group_idx").on(table.groupId),
    index("purchase_history_purchased_idx").on(table.purchasedAt),
  ]
)

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
