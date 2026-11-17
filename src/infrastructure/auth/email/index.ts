import { withRecipientAllowlist } from "./allowlist"
import { ConsoleEmailSender } from "./ConsoleEmailSender"
import type { EmailSender } from "./EmailSender"
import { resolveEmailConfig } from "./env"
import { ResendEmailSender } from "./ResendEmailSender"
import { TestMailboxEmailSender } from "./TestMailboxEmailSender"

export type { EmailNotice, EmailSender, OtpType, SendNoticeInput, SendOtpInput } from "./EmailSender"
export { EmailSendError } from "./EmailSender"
export { EmailConfigError, resolveEmailConfig, type EmailConfig } from "./env"
export { getTestMailbox, type TestMailbox } from "./TestMailboxEmailSender"

export interface CreateEmailSenderDeps {
  fetch?: typeof fetch
  log?: (message: string) => void
}

/**
 * 環境に応じた EmailSender を作る（A3 の Better Auth の設定から呼ぶ）
 *
 * 設定が正しくなければ EmailConfigError を投げる（本番で RESEND_API_KEY がない、など）
 */
export function createEmailSender(
  env: Record<string, string | undefined> = process.env,
  deps: CreateEmailSenderDeps = {}
): EmailSender {
  const config = resolveEmailConfig(env)
  const sender: EmailSender =
    config.mode === "resend"
      ? new ResendEmailSender({ apiKey: config.apiKey, from: config.from, fetch: deps.fetch })
      : config.mode === "test"
        ? new TestMailboxEmailSender()
        : new ConsoleEmailSender({ log: deps.log })
  return config.allowlist ? withRecipientAllowlist(sender, config.allowlist, deps.log) : sender
}
