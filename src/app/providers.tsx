"use client"

import { AuthProvider } from "@/contexts/AuthContext"
import { GroupProvider } from "@/contexts/GroupContext"
import { DataMergeProvider } from "@/contexts/DataMergeContext"
import { SyncProvider } from "@/contexts/SyncContext"
import { ThemeProvider } from "@/contexts/ThemeContext"
import { DBProvider } from "@/lib/db/provider"
import { TRPCProvider } from "@/infrastructure/trpc/provider"
import { DataMergeStatus } from "@/components/features/sync/DataMergeStatus"
import { OnboardingGate } from "@/components/auth/OnboardingGate"
import { type ReactNode } from "react"

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <TRPCProvider>
        <AuthProvider>
          <DataMergeProvider>
            <SyncProvider>
              <GroupProvider>
                <DBProvider>
                  {children}
                  <DataMergeStatus />
                  <OnboardingGate />
                </DBProvider>
              </GroupProvider>
            </SyncProvider>
          </DataMergeProvider>
        </AuthProvider>
      </TRPCProvider>
    </ThemeProvider>
  )
}
