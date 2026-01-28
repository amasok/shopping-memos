"use client"

import { AuthProvider } from "@/contexts/AuthContext"
import { GroupProvider } from "@/contexts/GroupContext"
import { DBProvider } from "@/lib/db/provider"
import { type ReactNode } from "react"

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <GroupProvider>
        <DBProvider>{children}</DBProvider>
      </GroupProvider>
    </AuthProvider>
  )
}
