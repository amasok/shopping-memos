"use client"

import { DBProvider } from "@/lib/db/provider"
import { type ReactNode } from "react"

export function Providers({ children }: { children: ReactNode }) {
  return <DBProvider>{children}</DBProvider>
}
