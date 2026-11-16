"use client"

import type { ReactNode } from "react"
import { SerwistProvider } from "@serwist/turbopack/react"
import { SWKillSwitch } from "./SWKillSwitch"
import { isSwEnabled } from "@/lib/sw/kill-switch"

export function AppServiceWorker({ children }: { children: ReactNode }) {
  if (!isSwEnabled()) {
    return (
      <>
        {children}
        <SWKillSwitch />
      </>
    )
  }
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      // 開発環境ではキャッシュしない
      disable={process.env.NODE_ENV === "development"}
      options={{ scope: "/", updateViaCache: "none" }}
    >
      {children}
    </SerwistProvider>
  )
}
