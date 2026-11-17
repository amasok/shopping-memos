// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest"
import { EmailSendError, type EmailSender } from "../EmailSender"
import { RESEND_API_URL, ResendEmailSender } from "../ResendEmailSender"
import { ConsoleEmailSender } from "../ConsoleEmailSender"
import { TestMailboxEmailSender, getTestMailbox } from "../TestMailboxEmailSender"
import { withRecipientAllowlist } from "../allowlist"

const API_KEY = "re_test_dummy_key_for_unit_tests"
const FROM = "買い物メモ <noreply@mail.example.com>"

function okResponse() {
  return new Response(JSON.stringify({ id: "email_1" }), { status: 200 })
}

describe("ResendEmailSender", () => {
  function setup(response: () => Promise<Response> = async () => okResponse()) {
    const fetchMock = vi.fn<typeof fetch>(response)
    const sender = new ResendEmailSender({ apiKey: API_KEY, from: FROM, fetch: fetchMock })
    return { sender, fetchMock }
  }

  function sentRequest(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
    const [url, init] = fetchMock.mock.calls[0]
    return { url, init: init!, body: JSON.parse(String(init!.body)) }
  }

  it("OTP を Resend の API に送る（宛先・送信元・件名・本文・認証ヘッダ）", async () => {
    const { sender, fetchMock } = setup()
    await sender.sendOtp({ to: "taro@example.com", otp: "123456", type: "sign-in" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url, init, body } = sentRequest(fetchMock)
    expect(url).toBe(RESEND_API_URL)
    expect(init.method).toBe("POST")
    const headers = new Headers(init.headers)
    expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`)
    expect(headers.get("content-type")).toBe("application/json")
    expect(body).toMatchObject({
      from: FROM,
      to: ["taro@example.com"],
      subject: "【買い物メモ】ログインコード",
    })
    expect(body.text).toContain("123456")
    expect(body.text).toContain("5 分")
    expect(body.html).toContain("123456")
    expect(`${body.text}${body.html}`).not.toMatch(/https?:\/\//)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("通知を送る", async () => {
    const { sender, fetchMock } = setup()
    await sender.sendNotice({ to: "taro@example.com", notice: { kind: "passkey-added" } })
    expect(sentRequest(fetchMock).body.subject).toBe("【買い物メモ】新しいパスキーが登録されました")
  })

  it("正規化されていない・不正な宛先には送らずにエラーにする", async () => {
    const { sender, fetchMock } = setup()
    for (const to of ["Taro@Example.com", "taro@example.com\r\nBcc: x@example.com", "taro"]) {
      await expect(sender.sendOtp({ to, otp: "123456", type: "sign-in" })).rejects.toThrow(
        EmailSendError
      )
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("API がエラーを返したら EmailSendError（ステータスつき）を投げ、キーとコードをメッセージに含めない", async () => {
    const { sender } = setup(
      async () => new Response(JSON.stringify({ message: `invalid key ${API_KEY}` }), { status: 401 })
    )
    const error = await sender
      .sendOtp({ to: "taro@example.com", otp: "987654", type: "sign-in" })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EmailSendError)
    expect((error as EmailSendError).status).toBe(401)
    expect((error as Error).message).not.toContain(API_KEY)
    expect((error as Error).message).not.toContain("987654")
  })

  it("通信に失敗したら EmailSendError を投げる（元のエラーのメッセージは含めない）", async () => {
    const { sender } = setup(async () => {
      throw new TypeError(`fetch failed ${API_KEY}`)
    })
    const error = await sender
      .sendOtp({ to: "taro@example.com", otp: "123456", type: "sign-in" })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EmailSendError)
    expect((error as EmailSendError).status).toBeUndefined()
    expect((error as Error).message).not.toContain(API_KEY)
  })

  it("API キーや送信元が空なら作れない", () => {
    expect(() => new ResendEmailSender({ apiKey: "", from: FROM })).toThrow()
    expect(() => new ResendEmailSender({ apiKey: API_KEY, from: "" })).toThrow()
  })
})

describe("ConsoleEmailSender", () => {
  it("OTP をログに出す（開発用）", async () => {
    const log = vi.fn()
    const sender = new ConsoleEmailSender({ log })
    await sender.sendOtp({ to: "taro@example.com", otp: "123456", type: "sign-in" })
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain("taro@example.com")
    expect(log.mock.calls[0][0]).toContain("123456")
  })

  it("通知は件名をログに出す", async () => {
    const log = vi.fn()
    await new ConsoleEmailSender({ log }).sendNotice({
      to: "taro@example.com",
      notice: { kind: "otp-locked" },
    })
    expect(log.mock.calls[0][0]).toContain("【買い物メモ】ログインを一時的に制限しました")
  })

  it("log を渡さなければ console.info に出す", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    await new ConsoleEmailSender().sendOtp({ to: "taro@example.com", otp: "123456", type: "sign-in" })
    expect(info).toHaveBeenCalledTimes(1)
    info.mockRestore()
  })
})

describe("TestMailboxEmailSender", () => {
  afterEach(() => getTestMailbox().clear())

  it("宛先ごとに直近の OTP を持つ", async () => {
    const sender = new TestMailboxEmailSender()
    await sender.sendOtp({ to: "taro@example.com", otp: "111111", type: "sign-in" })
    await sender.sendOtp({ to: "taro@example.com", otp: "222222", type: "sign-in" })
    await sender.sendOtp({ to: "hanako@example.com", otp: "333333", type: "sign-in" })

    expect(getTestMailbox().latestOtp("taro@example.com")).toMatchObject({ otp: "222222", type: "sign-in" })
    expect(getTestMailbox().latestOtp("hanako@example.com")?.otp).toBe("333333")
    expect(getTestMailbox().latestOtp("jiro@example.com")).toBeUndefined()
  })

  it("引くときのアドレスも正規化する", async () => {
    await new TestMailboxEmailSender().sendOtp({ to: "taro@example.com", otp: "111111", type: "sign-in" })
    expect(getTestMailbox().latestOtp(" Taro@Example.com ")?.otp).toBe("111111")
  })

  it("通知を宛先ごとに順に持つ", async () => {
    const sender = new TestMailboxEmailSender()
    await sender.sendNotice({ to: "taro@example.com", notice: { kind: "passkey-added" } })
    await sender.sendNotice({ to: "taro@example.com", notice: { kind: "passkey-removed" } })
    expect(getTestMailbox().notices("taro@example.com").map((n) => n.kind)).toEqual([
      "passkey-added",
      "passkey-removed",
    ])
    expect(getTestMailbox().notices("hanako@example.com")).toEqual([])
  })

  it("globalThis に持つので、別のインスタンスからも同じ中身が見える", async () => {
    await new TestMailboxEmailSender().sendOtp({ to: "taro@example.com", otp: "444444", type: "sign-in" })
    const key = Symbol.for("shopping-memos.test-mailbox")
    expect((globalThis as Record<symbol, unknown>)[key]).toBe(getTestMailbox())
    expect(getTestMailbox().latestOtp("taro@example.com")?.otp).toBe("444444")
  })

  it("clear で空にする", async () => {
    await new TestMailboxEmailSender().sendOtp({ to: "taro@example.com", otp: "555555", type: "sign-in" })
    getTestMailbox().clear()
    expect(getTestMailbox().latestOtp("taro@example.com")).toBeUndefined()
  })

  it("不正なコードは受け付けない（本物の送信と同じく文面の検証を通す）", async () => {
    await expect(
      new TestMailboxEmailSender().sendOtp({ to: "taro@example.com", otp: "abc", type: "sign-in" })
    ).rejects.toThrow()
  })
})

describe("送信先の許可リスト", () => {
  function fakeSender(): EmailSender & { sendOtp: ReturnType<typeof vi.fn>; sendNotice: ReturnType<typeof vi.fn> } {
    return { sendOtp: vi.fn(async () => {}), sendNotice: vi.fn(async () => {}) }
  }

  it("リストにある宛先には送る", async () => {
    const inner = fakeSender()
    const sender = withRecipientAllowlist(inner, new Set(["taro@example.com"]), vi.fn())
    await sender.sendOtp({ to: "taro@example.com", otp: "123456", type: "sign-in" })
    await sender.sendNotice({ to: "taro@example.com", notice: { kind: "otp-locked" } })
    expect(inner.sendOtp).toHaveBeenCalledTimes(1)
    expect(inner.sendNotice).toHaveBeenCalledTimes(1)
  })

  it("リスト外の宛先には送らず、エラーにもしない（呼び出し側には送ったのと同じに見せる）", async () => {
    const inner = fakeSender()
    const log = vi.fn()
    const sender = withRecipientAllowlist(inner, new Set(["taro@example.com"]), log)
    await expect(
      sender.sendOtp({ to: "evil@example.com", otp: "123456", type: "sign-in" })
    ).resolves.toBeUndefined()
    await expect(
      sender.sendNotice({ to: "evil@example.com", notice: { kind: "otp-locked" } })
    ).resolves.toBeUndefined()
    expect(inner.sendOtp).not.toHaveBeenCalled()
    expect(inner.sendNotice).not.toHaveBeenCalled()
    // 送らなかったことはログに出すが、宛先は出さない
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls.flat().join(" ")).not.toContain("evil@example.com")
  })

  it("宛先は正規化して比べる", async () => {
    const inner = fakeSender()
    const sender = withRecipientAllowlist(inner, new Set(["taro@example.com"]), vi.fn())
    await sender.sendOtp({ to: "Taro@Example.com", otp: "123456", type: "sign-in" })
    expect(inner.sendOtp).toHaveBeenCalledTimes(1)
  })

  it("log を渡さなければ console.warn に出す", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const sender = withRecipientAllowlist(fakeSender(), new Set(["taro@example.com"]))
    await sender.sendOtp({ to: "evil@example.com", otp: "123456", type: "sign-in" })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
