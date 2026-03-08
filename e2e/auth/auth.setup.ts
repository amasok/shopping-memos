import { test as setup } from "@playwright/test"
import {
  USER_A_EMAIL,
  USER_B_EMAIL,
  USER_A_STORAGE,
  USER_B_STORAGE,
  loginAndSaveState,
} from "./fixtures/auth-helpers"
import { cleanupE2EData } from "./fixtures/db-helpers"

/**
 * 認証セットアップ
 * 2ユーザー分の認証状態を保存
 */

setup("cleanup e2e data", async () => {
  await cleanupE2EData()
})

setup("authenticate user-a", async ({ page }) => {
  await loginAndSaveState(page, USER_A_EMAIL, USER_A_STORAGE)
})

setup("authenticate user-b", async ({ page }) => {
  await loginAndSaveState(page, USER_B_EMAIL, USER_B_STORAGE)
})
