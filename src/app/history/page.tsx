"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { EmptyState, PageContainer } from "@/components/ui"
import { cn } from "@/lib/utils"
import { ChevronRight, History, ShoppingBag } from "lucide-react"
import Link from "next/link"

// モックデータ
const mockHistory = [
  {
    id: "1",
    date: "2024-01-28",
    location: "イオン",
    itemCount: 5,
    items: ["牛乳", "食パン", "卵", "トマト", "洗剤"],
  },
  {
    id: "2",
    date: "2024-01-25",
    location: "西友",
    itemCount: 3,
    items: ["ティッシュ", "シャンプー", "石鹸"],
  },
  {
    id: "3",
    date: "2024-01-22",
    location: "コンビニ",
    itemCount: 2,
    items: ["おにぎり", "お茶"],
  },
]

interface PurchaseHistory {
  id: string
  date: string
  location: string
  itemCount: number
  items: string[]
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"]
  const weekday = weekdays[date.getDay()]
  return `${month}/${day}（${weekday}）`
}

export default function HistoryPage() {
  const history: PurchaseHistory[] = mockHistory
  const hasHistory = history.length > 0

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
            {history.map((record) => (
              <li key={record.id}>
                <Link
                  href={`/history/${record.id}`}
                  className={cn(
                    "block rounded-xl bg-white p-4 shadow-sm",
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
                          {formatDate(record.date)} · {record.itemCount}点
                        </p>
                        <p className="mt-1 text-sm text-gray-400">
                          {record.items.slice(0, 3).join("、")}
                          {record.items.length > 3 && " ..."}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="mt-2 h-5 w-5 text-gray-400" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageContainer>
    </AppLayout>
  )
}
