"use client"

import { useCallback, useEffect, useState } from "react"
import type { Serwist } from "@serwist/window"

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * SW の更新を扱う。
 * - 新しい SW が waiting になったら `waiting` を true にする
 * - `applyUpdate()` で SKIP_WAITING を送り、controlling になったら 1 回だけリロードする
 * - 前面に戻ったとき・1 時間ごとに `update()` を呼ぶ
 */
export function useServiceWorkerUpdate(serwist: Serwist | null) {
  const [waiting, setWaiting] = useState(false)

  useEffect(() => {
    if (!serwist) return

    const onWaiting = () => setWaiting(true)
    let reloaded = false
    const onControlling = (event: { isUpdate?: boolean }) => {
      // 初回インストール（isUpdate なし）ではリロードしない
      if (!event.isUpdate || reloaded) return
      reloaded = true
      window.location.reload()
    }
    serwist.addEventListener("waiting", onWaiting)
    serwist.addEventListener("controlling", onControlling)

    // リスナー登録より前に waiting になっていた場合
    navigator.serviceWorker
      ?.getRegistration()
      .then((reg) => {
        if (reg?.waiting && navigator.serviceWorker.controller) setWaiting(true)
      })
      .catch(() => {})

    const check = () => {
      serwist.update().catch(() => {})
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") check()
    }
    document.addEventListener("visibilitychange", onVisibility)
    const timer = window.setInterval(check, UPDATE_CHECK_INTERVAL_MS)

    return () => {
      serwist.removeEventListener("waiting", onWaiting)
      serwist.removeEventListener("controlling", onControlling)
      document.removeEventListener("visibilitychange", onVisibility)
      window.clearInterval(timer)
    }
  }, [serwist])

  const applyUpdate = useCallback(() => {
    serwist?.messageSkipWaiting()
  }, [serwist])

  return { waiting, applyUpdate }
}
