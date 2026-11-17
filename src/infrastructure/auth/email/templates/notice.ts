import type { EmailNotice } from "../EmailSender"
import { buildContent, type EmailContent } from "./layout"

const PASSKEY_NAME_MAX = 64

/** 利用者が付けたパスキーの名前を本文に入れられる形にする（改行・制御文字を除き、長さを切る） */
function sanitizeName(name: string | undefined): string | undefined {
  if (!name) return undefined
  const flat = name.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()
  return flat ? flat.slice(0, PASSKEY_NAME_MAX) : undefined
}

function passkeyLine(name: string | undefined): string[] {
  const safe = sanitizeName(name)
  return safe ? [`パスキーの名前: ${safe}`] : []
}

const LOGOUT_ADVICE =
  "心当たりがない場合は、メールのコードでログインし、設定画面の［すべての端末からログアウト］を押してから、身に覚えのないパスキーを削除してください。"

/** パスキーの追加・削除、ロック、管理者のアラートの通知（設計書「パスキー経由の乗っ取り対策」「ロック時の通知と解除」） */
export function renderNoticeEmail(notice: EmailNotice): EmailContent {
  switch (notice.kind) {
    case "passkey-added":
      return buildContent("新しいパスキーが登録されました", [
        "あなたのアカウントに、新しいパスキーが登録されました。",
        ...passkeyLine(notice.passkeyName),
        LOGOUT_ADVICE,
      ])
    case "passkey-removed":
      return buildContent("パスキーが削除されました", [
        "あなたのアカウントから、パスキーが削除されました。",
        ...passkeyLine(notice.passkeyName),
        LOGOUT_ADVICE,
      ])
    case "otp-locked":
      return buildContent("ログインを一時的に制限しました", [
        "ログインの試行が繰り返されたため一時的に制限しました。心当たりがなければ問題ありません。",
        "ご本人がパスキーでログインするか、ふだん使っている端末からメールのコードでログインすると、制限は解除されます。",
      ])
    case "otp-alert":
      return buildContent("ログインコードの送信数が多くなっています", [
        `直近 24 時間のログインコードの送信数が ${notice.sentCount} 通になり、しきい値の ${notice.threshold} 通を超えました。`,
        "送信サービスの 1 日の上限に近づいています。サーバーのログと送信サービスの管理画面を確認してください。",
      ])
  }
}
