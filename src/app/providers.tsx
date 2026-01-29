"use client"

import { AuthProvider } from "@/contexts/AuthContext"
import { GroupProvider } from "@/contexts/GroupContext"
import { DBProvider } from "@/lib/db/provider"
import { TRPCProvider } from "@/infrastructure/trpc/provider"
import { DataMergeStatus } from "@/components/features/sync/DataMergeStatus"
import { type ReactNode } from "react"

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TRPCProvider>
      <AuthProvider>
        <GroupProvider>
          <DBProvider>
            {children}
            <DataMergeStatus />
          </DBProvider>
        </GroupProvider>
      </AuthProvider>
    </TRPCProvider>
  )
}
