"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const emptySubscribe = () => () => {}

function useIsStandalone() {
  return useSyncExternalStore(
    emptySubscribe,
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator &&
        (navigator as unknown as { standalone: boolean }).standalone),
    () => false
  )
}

function useIsIOSDevice() {
  return useSyncExternalStore(
    emptySubscribe,
    () => {
      const ua = navigator.userAgent
      return /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window)
    },
    () => false
  )
}

export function useInstallPrompt() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)
  const [canInstall, setCanInstall] = useState(false)
  const [appInstalled, setAppInstalled] = useState(false)

  const isStandalone = useIsStandalone()
  const isIOS = useIsIOSDevice()
  const isInstalled = isStandalone || appInstalled

  useEffect(() => {
    if (isInstalled) return

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      deferredPrompt.current = e as BeforeInstallPromptEvent
      setCanInstall(true)
    }

    const handleAppInstalled = () => {
      setAppInstalled(true)
      setCanInstall(false)
      deferredPrompt.current = null
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
    window.addEventListener("appinstalled", handleAppInstalled)

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      )
      window.removeEventListener("appinstalled", handleAppInstalled)
    }
  }, [isInstalled])

  const install = useCallback(async () => {
    const prompt = deferredPrompt.current
    if (!prompt) return

    await prompt.prompt()
    const { outcome } = await prompt.userChoice

    if (outcome === "accepted") {
      setAppInstalled(true)
      setCanInstall(false)
    }
    deferredPrompt.current = null
  }, [])

  return { canInstall, isInstalled, isIOS, install }
}
