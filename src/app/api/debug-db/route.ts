import { NextResponse } from "next/server"
import postgres from "postgres"

export async function GET() {
  const url = process.env.DATABASE_URL
  if (!url) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 })
  }

  // 接続文字列からパスワードを隠す
  const safeUrl = url.replace(/:[^@]+@/, ":***@")

  const sql = postgres(url, { prepare: false, connect_timeout: 10 })

  try {
    const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    const accountsCols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'accounts' ORDER BY ordinal_position`

    // 実際に失敗しているクエリを試す
    const testQuery = await sql`
      SELECT accounts.user_id, users.id
      FROM accounts
      INNER JOIN users ON accounts.user_id = users.id
      WHERE accounts.provider = 'google' AND accounts.provider_account_id = 'test'
    `

    return NextResponse.json({
      connectionUrl: safeUrl,
      tables: tables.map((t) => t.tablename),
      accountsColumns: accountsCols.map((c) => c.column_name),
      testQueryResult: testQuery,
    })
  } catch (e) {
    return NextResponse.json(
      {
        connectionUrl: safeUrl,
        error: String(e),
        message: e instanceof Error ? e.message : "unknown",
        stack: e instanceof Error ? e.stack : undefined,
      },
      { status: 500 }
    )
  } finally {
    await sql.end()
  }
}
