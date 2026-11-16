import Credentials from "next-auth/providers/credentials"
import type { Provider } from "next-auth/providers"
import { eq } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import { users } from "@/infrastructure/db/drizzle/schema"
import {
  isE2EEmail,
  isE2ERequestAllowed,
  isE2ERuntimeEnabled,
} from "@/lib/e2e/guard"

/**
 * E2E 用のパスワードなしログイン（#70）
 *
 * `process.env.E2E_BUILD` は next.config.ts の `env` でビルド時に埋め込まれる。
 * `E2E_BUILD=true` 以外のビルドでは常に `"false"` になり、このプロバイダは登録されない。
 * さらに実行時の条件（E2E_TEST・VERCEL_ENV・x-e2e-token）と、
 * `@e2e-test.local` のアカウントだけに限定することで、既存ユーザーへのなりすましを防ぐ。
 *
 * 認証方式の置き換え（#61 A3）で削除する。
 */
function isE2EBuild(): boolean {
  return process.env.E2E_BUILD === "true"
}

export async function authorizeE2EUser(
  credentials: Partial<Record<string, unknown>> | undefined,
  request: Pick<Request, "headers">
) {
  if (!isE2EBuild() || !isE2ERequestAllowed(request)) return null

  const email =
    typeof credentials?.email === "string"
      ? credentials.email.trim().toLowerCase()
      : ""
  if (!isE2EEmail(email)) return null

  const [existing] = await db.select().from(users).where(eq(users.email, email))
  if (existing) return existing

  const [newUser] = await db
    .insert(users)
    .values({ id: crypto.randomUUID(), email, name: `Test User (${email})` })
    .returning()
  return newUser ?? null
}

export function e2eCredentialsProviders(): Provider[] {
  if (!isE2EBuild() || !isE2ERuntimeEnabled()) return []
  return [
    Credentials({
      name: "E2E Test",
      credentials: { email: { label: "Email", type: "email" } },
      authorize: authorizeE2EUser,
    }),
  ]
}
