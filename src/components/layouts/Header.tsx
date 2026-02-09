"use client"

import { cn } from "@/lib/utils"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

export interface HeaderProps {
  title: string
  showBackButton?: boolean
  backHref?: string
  rightAction?: React.ReactNode
}

export function Header({
  title,
  showBackButton = false,
  backHref,
  rightAction,
}: HeaderProps) {
  const router = useRouter()

  const handleBack = () => {
    if (backHref) {
      router.push(backHref)
    } else {
      router.back()
    }
  }

  return (
    <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {showBackButton && (
            backHref ? (
              <Link
                href={backHref}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full",
                  "text-gray-700 hover:bg-gray-100",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500"
                )}
                aria-label="戻る"
              >
                <ArrowLeft className="h-5 w-5" strokeWidth={2.5} />
              </Link>
            ) : (
              <button
                type="button"
                onClick={handleBack}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full",
                  "text-gray-700 hover:bg-gray-100",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500"
                )}
                aria-label="戻る"
              >
                <ArrowLeft className="h-5 w-5" strokeWidth={2.5} />
              </button>
            )
          )}
          <h1 className="text-lg font-bold text-gray-900">{title}</h1>
        </div>
        {rightAction && <div>{rightAction}</div>}
      </div>
    </header>
  )
}
