import { BottomNav } from "./BottomNav"

export interface AppLayoutProps {
  children: React.ReactNode
  showBottomNav?: boolean
}

export function AppLayout({ children, showBottomNav = true }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <main className={showBottomNav ? "pb-16" : ""}>{children}</main>
      {showBottomNav && <BottomNav />}
    </div>
  )
}
