import { afterEach, describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import { TurnstileChallenge } from "../TurnstileChallenge"
import { TURNSTILE_DUMMY_TOKEN, TURNSTILE_TEST_SITE_KEY } from "../useTurnstile"

describe("対話型の Turnstile（#61 A3b）", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("E2E のビルドでテスト用のサイトキーなら、スクリプトを読まずにすぐダミーのトークンを渡す", () => {
    vi.stubEnv("E2E_BUILD", "true")
    const onToken = vi.fn()
    render(<TurnstileChallenge siteKey={TURNSTILE_TEST_SITE_KEY} onToken={onToken} />)
    expect(onToken).toHaveBeenCalledWith(TURNSTILE_DUMMY_TOKEN)
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull()
  })

  it("本物のサイトキーなら、Turnstile のスクリプトを読み込み、すぐにはトークンを渡さない", () => {
    vi.stubEnv("E2E_BUILD", "false")
    const onToken = vi.fn()
    render(<TurnstileChallenge siteKey="0x4AAAAAAA-real-challenge-site" onToken={onToken} />)
    expect(onToken).not.toHaveBeenCalled()
    expect(document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')).not.toBeNull()
  })
})
