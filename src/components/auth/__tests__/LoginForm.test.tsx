import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, fireEvent } from "@testing-library/react"

/**
 * ログイン画面（#61 A3a 4.3）
 */
const state = vi.hoisted(() => ({
  send: vi.fn(),
  signIn: vi.fn(),
  getToken: vi.fn(async () => "turnstile-token"),
}))

vi.mock("@/infrastructure/auth/client", () => ({
  authClient: {
    emailOtp: { sendVerificationOtp: state.send },
    signIn: { emailOtp: state.signIn },
  },
}))
vi.mock("../useTurnstile", () => ({
  useTurnstile: () => ({ containerRef: { current: null }, getToken: state.getToken }),
}))
// 対話型のウィジェットの代わり。押すとトークンを渡す
vi.mock("../TurnstileChallenge", () => ({
  TurnstileChallenge: ({ onToken }: { onToken: (token: string) => void }) => (
    <button type="button" data-testid="challenge-solve" onClick={() => onToken("challenge-token")}>
      solve
    </button>
  ),
}))

import { LoginForm, RESEND_COOLDOWN_SECONDS } from "../LoginForm"

let assign: ReturnType<typeof vi.fn>
let online = true

beforeEach(() => {
  state.send.mockReset().mockResolvedValue({ data: { success: true }, error: null })
  state.signIn.mockReset().mockResolvedValue({ data: { token: "t" }, error: null })
  state.getToken.mockClear()
  assign = vi.fn()
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, origin: "http://localhost:3000", assign },
  })
  online = true
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online })
})

afterEach(() => {
  vi.useRealTimers()
})

async function submitEmail(email = " Taro@Example.com ") {
  fireEvent.change(screen.getByTestId("login-email"), { target: { value: email } })
  await act(async () => {
    fireEvent.click(screen.getByTestId("login-send-code"))
  })
}

describe("ログイン画面", () => {
  it("ログイン画面に Google のボタンがない", () => {
    render(<LoginForm callbackUrl={null} />)
    expect(screen.queryByText(/Google\s*でログイン|Googleでログイン/)).toBeNull()
    expect(screen.getByTestId("login-email")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "コードを送信" })).toBeInTheDocument()
  })

  it("ログイン画面に移行の案内が出る", () => {
    render(<LoginForm callbackUrl={null} />)
    expect(
      screen.getByText("ログイン方法が変わりました。以前 Google で使っていた Gmail のアドレスを入力してください")
    ).toBeInTheDocument()
  })

  it("正規化したアドレスに、Turnstile のトークンを付けてコードを送り、コードの入力に切り替わる", async () => {
    render(<LoginForm callbackUrl={null} />)
    await submitEmail()
    expect(state.send).toHaveBeenCalledWith(
      { email: "taro@example.com", type: "sign-in" },
      { headers: { "x-turnstile-token": "turnstile-token" } }
    )
    expect(screen.getByTestId("login-code-sent")).toHaveTextContent("taro@example.com に 6 桁のコードを送信しました")
    const otp = screen.getByTestId("login-otp")
    expect(otp).toHaveAttribute("autocomplete", "one-time-code")
    expect(otp).toHaveAttribute("inputmode", "numeric")
  })

  it("形式が正しくないアドレスは送らずに文言を出す", async () => {
    render(<LoginForm callbackUrl={null} />)
    await submitEmail("たろう@example.com")
    expect(state.send).not.toHaveBeenCalled()
    expect(screen.getByTestId("login-error")).toHaveTextContent("メールアドレスの形式が正しくありません")
  })

  it("送信の失敗（IP の上限）は文言を出し、メールの入力に残る", async () => {
    state.send.mockResolvedValue({ data: null, error: { status: 429, code: "RATE_LIMITED" } })
    render(<LoginForm callbackUrl={null} />)
    await submitEmail()
    expect(screen.getByTestId("login-error")).toHaveTextContent("しばらく時間をおいてからお試しください")
    expect(screen.getByTestId("login-email")).toBeInTheDocument()
  })

  it("送信から 60 秒は再送できない", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    render(<LoginForm callbackUrl={null} />)
    await submitEmail()
    const resend = screen.getByTestId("login-resend")
    expect(resend).toBeDisabled()
    expect(resend).toHaveTextContent(`再送信（${RESEND_COOLDOWN_SECONDS}秒後に有効）`)

    for (let i = 0; i < RESEND_COOLDOWN_SECONDS - 1; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
    }
    expect(screen.getByTestId("login-resend")).toBeDisabled()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId("login-resend")).toBeEnabled()
    expect(screen.getByTestId("login-resend")).toHaveTextContent(/^再送信$/)

    await act(async () => {
      fireEvent.click(screen.getByTestId("login-resend"))
    })
    expect(state.send).toHaveBeenCalledTimes(2)
    expect(state.getToken).toHaveBeenCalledTimes(2)
  })

  it("ログインに成功したら、戻り先を読み込み直す", async () => {
    render(<LoginForm callbackUrl="/groups" />)
    await submitEmail()
    fireEvent.change(screen.getByTestId("login-otp"), { target: { value: "12 34-56" } })
    await act(async () => {
      fireEvent.click(screen.getByTestId("login-submit"))
    })
    expect(state.signIn).toHaveBeenCalledWith({ email: "taro@example.com", otp: "123456" })
    expect(assign).toHaveBeenCalledWith("/groups")
  })

  it("戻り先が別のサイトならホームに移る", async () => {
    render(<LoginForm callbackUrl="//evil.example/" />)
    await submitEmail()
    fireEvent.change(screen.getByTestId("login-otp"), { target: { value: "123456" } })
    await act(async () => {
      fireEvent.click(screen.getByTestId("login-submit"))
    })
    expect(assign).toHaveBeenCalledWith("/")
  })

  it("まちがったコードには不一致の文言を出し、もう一度入力できる", async () => {
    state.signIn.mockResolvedValue({ data: null, error: { status: 400, code: "INVALID_OTP" } })
    render(<LoginForm callbackUrl={null} />)
    await submitEmail()
    fireEvent.change(screen.getByTestId("login-otp"), { target: { value: "000000" } })
    await act(async () => {
      fireEvent.click(screen.getByTestId("login-submit"))
    })
    expect(screen.getByTestId("login-error")).toHaveTextContent("コードが正しくありません")
    expect(screen.getByTestId("login-otp")).toBeEnabled()
    expect(assign).not.toHaveBeenCalled()
  })

  it("6 桁そろうまでログインは押せない", async () => {
    render(<LoginForm callbackUrl={null} />)
    await submitEmail()
    fireEvent.change(screen.getByTestId("login-otp"), { target: { value: "12345" } })
    expect(screen.getByTestId("login-submit")).toBeDisabled()
  })

  it("メールアドレスを変更でメールの入力に戻る", async () => {
    render(<LoginForm callbackUrl={null} />)
    await submitEmail()
    fireEvent.click(screen.getByTestId("login-change-email"))
    expect(screen.getByTestId("login-email")).toBeInTheDocument()
  })

  it("チャレンジが要るアドレスでは、対話型のウィジェットを出し、通ったらそのトークンで送り直す（#61 A3b）", async () => {
    state.send
      .mockResolvedValueOnce({ data: null, error: { status: 403, code: "TURNSTILE_CHALLENGE_REQUIRED" } })
      .mockResolvedValueOnce({ data: { success: true }, error: null })
    render(<LoginForm callbackUrl={null} />)
    await submitEmail()
    expect(screen.getByTestId("login-challenge")).toBeInTheDocument()
    expect(screen.getByTestId("login-error")).toHaveTextContent("確認のため、下の確認を完了してから送信してください")
    expect(screen.queryByTestId("login-code-sent")).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByTestId("challenge-solve"))
    })
    expect(state.send).toHaveBeenLastCalledWith(
      { email: "taro@example.com", type: "sign-in" },
      { headers: { "x-turnstile-token": "challenge-token" } }
    )
    expect(screen.getByTestId("login-code-sent")).toBeInTheDocument()
    expect(screen.queryByTestId("login-challenge")).toBeNull()
  })

  it("再送信でチャレンジが要ると言われたときも、対話型のウィジェットを出す", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    render(<LoginForm callbackUrl={null} />)
    await submitEmail()
    for (let i = 0; i < RESEND_COOLDOWN_SECONDS; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
    }
    state.send.mockResolvedValueOnce({ data: null, error: { status: 403, code: "TURNSTILE_CHALLENGE_REQUIRED" } })
    await act(async () => {
      fireEvent.click(screen.getByTestId("login-resend"))
    })
    expect(screen.getByTestId("login-challenge")).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByTestId("challenge-solve"))
    })
    expect(state.send).toHaveBeenLastCalledWith(
      { email: "taro@example.com", type: "sign-in" },
      { headers: { "x-turnstile-token": "challenge-token" } }
    )
    expect(screen.queryByTestId("login-challenge")).toBeNull()
  })

  it("オフラインではコードを送れない", async () => {
    online = false
    render(<LoginForm callbackUrl={null} />)
    expect(screen.getByTestId("login-offline")).toHaveTextContent("オフラインのためログインできません")
    expect(screen.getByTestId("login-send-code")).toBeDisabled()
  })

  it("オフラインになると「ログイン」も押せない", async () => {
    render(<LoginForm callbackUrl={null} />)
    await submitEmail()
    fireEvent.change(screen.getByTestId("login-otp"), { target: { value: "123456" } })
    expect(screen.getByTestId("login-submit")).toBeEnabled()
    online = false
    await act(async () => {
      window.dispatchEvent(new Event("offline"))
    })
    expect(screen.getByTestId("login-offline")).toBeInTheDocument()
    expect(screen.getByTestId("login-submit")).toBeDisabled()
  })
})
