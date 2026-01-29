"use client"

import { cn } from "@/lib/utils"
import { useLists } from "@/hooks/data"
import { ClipboardList, History, Home, Settings } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

interface NavItem {
  href: string
  icon: React.ReactNode
  label: string
  showBadge?: boolean
}

export function BottomNav() {
  const pathname = usePathname()

  // 進行中のリスト数を取得（全グループ＋個人を含む）
  const { lists } = useLists({
    status: "in_progress",
    includeAllGroups: true,
  })
  const activeListCount = lists.length

  const navItems: NavItem[] = [
    {
      href: "/",
      icon: <Home className="h-6 w-6" strokeWidth={2} />,
      label: "ホーム",
    },
    {
      href: "/lists",
      icon: <ClipboardList className="h-6 w-6" strokeWidth={2} />,
      label: "リスト",
      showBadge: (activeListCount ?? 0) > 0,
    },
    {
      href: "/history",
      icon: <History className="h-6 w-6" strokeWidth={2} />,
      label: "履歴",
    },
    {
      href: "/settings",
      icon: <Settings className="h-6 w-6" strokeWidth={2} />,
      label: "設定",
    },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-10 border-t border-gray-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto max-w-lg">
        <ul className="flex items-center justify-around">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "relative flex min-h-[56px] min-w-[64px] flex-col items-center justify-center gap-1 px-3 py-2",
                    "transition-colors",
                    "focus:outline-none",
                    isActive
                      ? "text-[var(--theme-primary)]"
                      : "text-gray-400 hover:text-gray-600"
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className="relative">
                    {item.icon}
                    {item.showBadge && (
                      <span
                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ backgroundColor: "var(--theme-accent)" }}
                      >
                        {activeListCount}
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-semibold">{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
