import { normalizeEmail } from "@/shared/schemas/email"
import type {
  EmailNotice,
  EmailSender,
  OtpType,
  SendNoticeInput,
  SendOtpInput,
} from "./EmailSender"
import { renderNoticeEmail } from "./templates/notice"
import { renderOtpEmail } from "./templates/otp"

export interface TestMailboxOtp {
  otp: string
  type: OtpType
  sentAt: Date
}

export interface TestMailbox {
  latestOtp(email: string): TestMailboxOtp | undefined
  notices(email: string): EmailNotice[]
  clear(): void
}

interface MailboxState extends TestMailbox {
  putOtp(email: string, otp: TestMailboxOtp): void
  putNotice(email: string, notice: EmailNotice): void
}

/**
 * 送ったメールを `globalThis` に持つ（E2E 用。設計書「### E2E のログイン」）
 *
 * DB の OTP はハッシュなので読み戻せない。また、モジュール変数だと Next.js のルートごとの
 * バンドルでインスタンスが分かれるおそれがあるので、`Symbol.for` のキーで globalThis に置く。
 * E2E のサーバーは 1 プロセスで動かす
 */
const MAILBOX_KEY = Symbol.for("shopping-memos.test-mailbox")

function key(email: string): string {
  return normalizeEmail(email) ?? email
}

function createMailbox(): MailboxState {
  const otps = new Map<string, TestMailboxOtp>()
  const notices = new Map<string, EmailNotice[]>()
  return {
    putOtp: (email, otp) => otps.set(key(email), otp),
    putNotice: (email, notice) => notices.set(key(email), [...(notices.get(key(email)) ?? []), notice]),
    latestOtp: (email) => otps.get(key(email)),
    notices: (email) => [...(notices.get(key(email)) ?? [])],
    clear: () => {
      otps.clear()
      notices.clear()
    },
  }
}

function mailboxState(): MailboxState {
  const store = globalThis as typeof globalThis & { [MAILBOX_KEY]?: MailboxState }
  store[MAILBOX_KEY] ??= createMailbox()
  return store[MAILBOX_KEY]
}

/** E2E のテスト用ルート（A3 の /api/test/otp）から読む */
export function getTestMailbox(): TestMailbox {
  return mailboxState()
}

export class TestMailboxEmailSender implements EmailSender {
  async sendOtp({ to, otp, type }: SendOtpInput): Promise<void> {
    renderOtpEmail({ otp, type })
    mailboxState().putOtp(to, { otp, type, sentAt: new Date() })
  }

  async sendNotice({ to, notice }: SendNoticeInput): Promise<void> {
    renderNoticeEmail(notice)
    mailboxState().putNotice(to, notice)
  }
}
