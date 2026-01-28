import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

// 環境変数からDB接続URLを取得
const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error("DATABASE_URL is not set")
}

// PostgreSQLクライアント
// 本番環境では接続プールを使用
const client = postgres(connectionString, {
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
