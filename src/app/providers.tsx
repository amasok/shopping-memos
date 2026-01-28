"use client"

import { AuthProvider } from "@/contexts/AuthContext"
import { DBProvider } from "@/lib/db/provider"
import { type ReactNode } from "react"

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <DBProvider>{children}</DBProvider>
    </AuthProvider>
  )
}
