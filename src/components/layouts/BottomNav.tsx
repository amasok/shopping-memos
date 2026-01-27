"use client"

import { cn } from "@/lib/utils"
import { ClipboardList, History, Home, Settings } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

interface NavItem {
  href: string
  icon: React.ReactNode
  label: string
}

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

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-10 border-t border-gray-200 bg-white">
      <div className="mx-auto max-w-lg">
        <ul className="flex items-center justify-around">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex min-h-[56px] min-w-[64px] flex-col items-center justify-center gap-1 px-3 py-2",
                    "transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500",
                    isActive
                      ? "text-blue-600"
                      : "text-gray-500 hover:text-gray-900"
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item.icon}
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
