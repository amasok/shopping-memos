"use client"

import { useEffect, useRef } from "react"
import {
  TURNSTILE_ACTION,
  TURNSTILE_DUMMY_TOKEN,
  loadTurnstileScript,
  turnstileChallengeSiteKey,
  usesDummyTurnstile,
} from "./useTurnstile"

/**
 * 狙われたアドレス用の対話型の Turnstile（#61 A3b）
 *
 * サーバーが TURNSTILE_CHALLENGE_REQUIRED を返したときにだけ出す。利用者が確認を終えると onToken にトークンを渡す
 * （送信はそのトークンで送り直す。トークンは 1 回しか使えないので、使ったら部品ごと外す）。
 * E2E のビルドでテスト用のサイトキーのときは、スクリプトを読まずにすぐダミーのトークンを渡す
 */
export function TurnstileChallenge({
  onToken,
  onError,
  siteKey = turnstileChallengeSiteKey(),
}: {
  onToken: (token: string) => void
  /** ウィジェットがエラーになった・読み込めなかった（利用者に読み込み直しを案内する） */
  onError?: () => void
  siteKey?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onTokenRef.current = onToken
    onErrorRef.current = onError
  }, [onToken, onError])

  useEffect(() => {
    if (usesDummyTurnstile(siteKey)) {
      onTokenRef.current(TURNSTILE_DUMMY_TOKEN)
      return
    }
    let widgetId: string | null = null
    let cancelled = false
    loadTurnstileScript()
      .then((api) => {
        if (cancelled || !containerRef.current) return
        widgetId = api.render(containerRef.current, {
          sitekey: siteKey,
          action: TURNSTILE_ACTION,
          execution: "render",
          appearance: "always",
          callback: (token) => onTokenRef.current(token),
          "error-callback": () => onErrorRef.current?.(),
          "expired-callback": () => {},
        })
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current?.()
      })
    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey])

  return <div ref={containerRef} data-testid="turnstile-challenge" />
}
