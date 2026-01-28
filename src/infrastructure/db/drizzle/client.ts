import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

// 環境変数からDB接続URLを取得
const connectionString = process.env.DATABASE_URL

// ビルド時はダミー接続文字列を使用（実際には接続しない）
const effectiveConnectionString =
  connectionString || "postgresql://dummy:dummy@localhost:5432/dummy"

// PostgreSQLクライアント
const client = postgres(effectiveConnectionString, {
  max: process.env.NODE_ENV === "production" ? 10 : 1,
  idle_timeout: 20,
  connect_timeout: 10,
})

/**
 * Drizzle ORMクライアント
 * スキーマを含むため、リレーションクエリが可能
 */
export const db = drizzle(client, { schema })

/**
 * DB型（リポジトリのDI用）
 */
export type DrizzleDB = typeof db
