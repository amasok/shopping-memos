"use client"

import { useCallback, useEffect, useRef } from "react"

/**
 * 非表示の Turnstile（#61 A3a 4.3。design の D4「Turnstile」）
 *
 * コードの送信のたびに getToken() で新しいトークンを取る（トークンは 1 回しか使えないので、使った後は reset する）。
 * E2E のビルドで Cloudflare のテスト用のサイトキーのときは、スクリプトを読まずに Cloudflare のダミーのトークンを返す
 * （E2E を外のネットワークに頼らせない。サーバーもテスト用の secret ではネットワークに出ない）
 */

export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA"
export const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX"
export const TURNSTILE_ACTION = "send-otp"
const TOKEN_TIMEOUT_MS = 30_000

export interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string
      action: string
      execution: "execute" | "render"
      appearance: "interaction-only" | "always"
      callback: (token: string) => void
      "error-callback": () => void
      "expired-callback": () => void
    }
  ): string
  execute(widgetId: string): void
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export function turnstileSiteKey(): string {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || TURNSTILE_TEST_SITE_KEY
}

/** 狙われたアドレス用の対話型のウィジェットのサイトキー（#61 A3b） */
export function turnstileChallengeSiteKey(): string {
  return process.env.NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY || TURNSTILE_TEST_SITE_KEY
}

/** スクリプトを読まずにダミーのトークンを返すか（E2E のビルドでテスト用のキーのときだけ） */
export function usesDummyTurnstile(siteKey: string, e2eBuild = process.env.E2E_BUILD === "true"): boolean {
  return e2eBuild && /^[123]x0000/.test(siteKey)
}

let scriptPromise: Promise<TurnstileApi> | null = null

export function loadTurnstileScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = TURNSTILE_SCRIPT_URL
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")))
    script.onerror = () => {
      scriptPromise = null
      reject(new Error("turnstile"))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export function useTurnstile(siteKey: string = turnstileSiteKey()) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const pending = useRef<((token: string | null) => void) | null>(null)
  const dummy = usesDummyTurnstile(siteKey)

  useEffect(() => {
    if (dummy) return
    let cancelled = false
    loadTurnstileScript()
      .then((api) => {
        if (cancelled || !containerRef.current || widgetId.current) return
        const settle = (token: string | null) => {
          pending.current?.(token)
          pending.current = null
        }
        widgetId.current = api.render(containerRef.current, {
          sitekey: siteKey,
          action: TURNSTILE_ACTION,
          execution: "execute",
          appearance: "interaction-only",
          callback: (token) => settle(token),
          "error-callback": () => settle(null),
          "expired-callback": () => settle(null),
        })
      })
      .catch(() => {
        // 読み込めなければ getToken が null を返し、サーバーが送信を断る
      })
    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
      widgetId.current = null
    }
  }, [dummy, siteKey])

  /** 送信に付けるトークン。取れなければ null（サーバーが送信を断る） */
  const getToken = useCallback(async (): Promise<string | null> => {
    if (dummy) return TURNSTILE_DUMMY_TOKEN
    const api = window.turnstile
    const id = widgetId.current
    if (!api || !id) return null
    api.reset(id)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.current = null
        resolve(null)
      }, TOKEN_TIMEOUT_MS)
      pending.current = (token) => {
        clearTimeout(timer)
        resolve(token)
      }
      api.execute(id)
    })
  }, [dummy])

  return { containerRef, getToken }
}
