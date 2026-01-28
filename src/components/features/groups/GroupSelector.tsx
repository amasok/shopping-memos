"use client"

import { cn } from "@/lib/utils"
import { Users } from "lucide-react"

interface Group {
  id: string
  name: string
}

interface GroupSelectorProps {
  selectedGroupId: string | undefined
  groups: Group[] | undefined
  onGroupChange: (groupId: string | undefined) => void
  label?: string
  size?: "sm" | "md"
}

const sizeClasses = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
}

export function GroupSelector({
  selectedGroupId,
  groups,
  onGroupChange,
  label,
  size = "sm",
}: GroupSelectorProps) {
  if (!groups || groups.length === 0) {
    return null
  }

  return (
    <div>
      {label && (
        <label className="mb-2 block text-base font-semibold text-gray-900">
          {label}
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onGroupChange(undefined)}
          className={cn(
            "flex items-center gap-2 rounded-full font-semibold transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
            sizeClasses[size],
            selectedGroupId === undefined
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          )}
        >
          個人
        </button>
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => onGroupChange(group.id)}
            className={cn(
              "flex items-center gap-2 rounded-full font-semibold transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
              sizeClasses[size],
              selectedGroupId === group.id
                ? "bg-purple-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            )}
          >
            <Users className="h-4 w-4" />
            {group.name}
          </button>
        ))}
      </div>
    </div>
  )
}
