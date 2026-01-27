"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { EmptyState, PageContainer } from "@/components/ui"
import { db } from "@/lib/db"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import { ChevronDown, ChevronUp, History, ShoppingBag } from "lucide-react"
import { useState } from "react"

function formatDate(date: Date): string {
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"]
  const weekday = weekdays[date.getDay()]
  return `${month}/${day}（${weekday}）`
}

export default function HistoryPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const history = useLiveQuery(
    () => db.history.orderBy("purchasedAt").reverse().toArray(),
    []
  )

  const isLoading = history === undefined

  if (isLoading) {
    return (
      <AppLayout>
        <Header title="購入履歴" />
        <PageContainer>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  const hasHistory = (history?.length ?? 0) > 0

  return (
    <AppLayout>
      <Header title="購入履歴" />
      <PageContainer>
        {!hasHistory ? (
          <EmptyState
            icon={<History className="h-16 w-16" />}
            title="購入履歴がありません"
            description="買い物リストを完了すると記録されます"
          />
        ) : (
          <ul className="space-y-3">
            {history?.map((record) => {
              const isExpanded = expandedId === record.id
              return (
                <li key={record.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : record.id)
                    }
                    className={cn(
                      "w-full rounded-xl bg-white p-4 shadow-sm text-left",
                      "transition-colors hover:bg-gray-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                          <ShoppingBag className="h-5 w-5 text-gray-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">
                            {record.location || "買い物"}
                          </p>
                          <p className="text-sm text-gray-500">
                            {formatDate(record.purchasedAt)} · {record.items.length}点
                          </p>
                          {!isExpanded && (
                            <p className="mt-1 text-sm text-gray-400">
                              {record.items
                                .slice(0, 3)
                                .map((item) => item.name)
                                .join("、")}
                              {record.items.length > 3 && " ..."}
                            </p>
                          )}
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="mt-2 h-5 w-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="mt-2 h-5 w-5 text-gray-400" />
                      )}
                    </div>

                    {isExpanded && (
                      <div className="mt-4 border-t border-gray-100 pt-4">
                        <ul className="space-y-2">
                          {record.items.map((item, index) => (
                            <li
                              key={index}
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="text-gray-700">{item.name}</span>
                              {item.quantity > 1 && (
                                <span className="text-gray-500">
                                  x{item.quantity}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </PageContainer>
    </AppLayout>
  )
}
