import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import type { Adapter } from "next-auth/adapters"
import { eq } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@/infrastructure/db/drizzle/schema"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }) as Adapter,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    ...(process.env.E2E_TEST === "true"
      ? [
          Credentials({
            name: "E2E Test",
            credentials: {
              email: { label: "Email", type: "email" },
            },
            async authorize(credentials) {
              if (process.env.E2E_TEST !== "true") return null
              const email = credentials?.email as string
              if (!email) return null

              const [existing] = await db
                .select()
                .from(users)
                .where(eq(users.email, email))
              if (existing) return existing

              const id = crypto.randomUUID()
              const [newUser] = await db
                .insert(users)
                .values({
                  id,
                  email,
                  name: `Test User (${email})`,
                })
                .returning()
              return newUser
            },
          }),
        ]
      : []),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string
      }
      return session
    },
  },
  pages: {
    signIn: "/login",
  },
})
