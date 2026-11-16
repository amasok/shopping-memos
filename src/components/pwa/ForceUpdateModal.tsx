"use client"

import { useEffect, useState } from "react"
import type { Serwist } from "@serwist/window"
import {
  SKIP_WAITING_MESSAGE,
  fetchVersionInfo,
  getClientRelease,
  shouldForceUpdate,
} from "@/lib/sw/version"

const RELOAD_GUARD_KEY = "sm-force-update-at"
const RELOAD_GUARD_MS = 60 * 1000

/** 最低リリース番号を下回ったときに出す、閉じられないモーダル。更新後は自動でリロードする */
export function ForceUpdateModal({ serwist }: { serwist: Serwist | null }) {
  const [forced, setForced] = useState(false)

  useEffect(() => {
    const check = async () => {
      const info = await fetchVersionInfo()
      if (info && shouldForceUpdate(getClientRelease(), info)) {
        setForced(true)
      }
    }
    void check()
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  useEffect(() => {
    if (!forced) return
    void (async () => {
      try {
        await serwist?.update()
        const reg = await navigator.serviceWorker?.getRegistration()
        if (reg?.waiting) {
          // serwist が無くても確実に切り替わるよう、waiting の SW へ直接送り、有効になったらリロードする
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => window.location.reload(),
            { once: true },
          )
          reg.waiting.postMessage({ type: SKIP_WAITING_MESSAGE })
          return
        }
      } catch {
        // 続けてリロードにフォールバックする
      }
      // 更新が見つからない場合のリロード。設定ミスでループしないよう 1 分に 1 回までにする
      try {
        const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0)
        if (Date.now() - last < RELOAD_GUARD_MS) return
        sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
      } catch {
        return
      }
      window.location.reload()
    })()
  }, [forced, serwist])

  if (!forced) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="アプリを更新します"
        data-testid="force-update-modal"
        className="rounded-lg bg-white p-6 text-center shadow-xl"
      >
        <p className="font-bold">アプリを更新します</p>
        <p className="mt-2 text-sm text-gray-600">
          新しいバージョンを読み込んでいます。入力中の内容は端末に保存されています。
        </p>
      </div>
    </div>
  )
}
