import { eq } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import { users } from "@/infrastructure/db/drizzle/schema"

/**
 * ユーザーの表示名の保存（#61 A4。design の D2）
 *
 * 書き換えるのは渡された userId の行の name と updated_at だけ（呼ぶ側は ctx.userId を渡す）
 */
export const userProfileRepository = {
  async updateDisplayName(userId: string, name: string): Promise<{ name: string } | null> {
    const [row] = await db
      .update(users)
      .set({ name, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ name: users.name })
    return row ? { name: row.name ?? "" } : null
  },
}
