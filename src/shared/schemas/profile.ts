import { TEXT_LIMITS } from "./limits"
import { z } from "./z"

/**
 * 表示名の検証（#61 A4。change 61-a4-display-name-account の design の D1）
 *
 * 画面（/onboarding・設定の変更）とサーバー（identity.updateProfile）で共用する。順は
 * NFKC → 前後の空白を除く → 空でない → 改行・制御文字（Cc・Zl・Zp）と Unicode の書式の文字（Cf）を含まない → 50 文字まで。
 * 書式の文字（向きを変える文字・ゼロ幅の文字など）は NFKC では消えないので、別に確かめる
 * （グループのメンバー一覧で、表示を崩したり、ほかの家族の名前に見せかけたりできないように）。
 * 文字数はコードポイントで数える（絵文字 1 つが 1 文字）
 */

export const DISPLAY_NAME_MESSAGES = {
  required: "表示名を入力してください",
  tooLong: `表示名は ${TEXT_LIMITS.displayName} 文字までです`,
  invalidChars: "使えない文字が含まれています",
} as const

// 行と段落の区切り（U+2028・U+2029。一般カテゴリ Zl・Zp）も改行として拒否する
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

/** 表示名の文字数（コードポイント） */
export function displayNameLength(value: string): number {
  return [...value].length
}

export const displayNameSchema = z
  .string({ message: DISPLAY_NAME_MESSAGES.required })
  .transform((value) => value.normalize("NFKC").trim())
  .superRefine((value, ctx) => {
    if (value.length === 0) {
      ctx.addIssue({ code: "custom", message: DISPLAY_NAME_MESSAGES.required })
    } else if (CONTROL_OR_FORMAT.test(value)) {
      ctx.addIssue({ code: "custom", message: DISPLAY_NAME_MESSAGES.invalidChars })
    } else if (displayNameLength(value) > TEXT_LIMITS.displayName) {
      ctx.addIssue({ code: "custom", message: DISPLAY_NAME_MESSAGES.tooLong })
    }
  })

/** identity.updateProfile の入力。name だけを受け取り、userId などの余計なキーは捨てる */
export const updateProfileSchema = z.object({ name: displayNameSchema })

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
