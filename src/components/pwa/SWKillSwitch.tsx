"use client"

import { useEffect } from "react"
import { unregisterAllServiceWorkers } from "@/lib/sw/kill-switch"

export function SWKillSwitch() {
  useEffect(() => {
    unregisterAllServiceWorkers().catch(() => {
      // 解除に失敗しても致命的ではない
    })
  }, [])
  return null
}
