"use client"

import { cn } from "@/lib/utils"

interface Tag {
  id: string
  name: string
}

interface TagFilterProps {
  tags: Tag[] | undefined
  selectedTagId: string | null
  onTagSelect: (tagId: string | null) => void
  tagItemCounts?: Map<string, number>
  label?: string
  size?: "sm" | "md"
  showItemCount?: boolean
}

const sizeClasses = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
}

export function TagFilter({
  tags,
  selectedTagId,
  onTagSelect,
  tagItemCounts,
  label,
  size = "sm",
  showItemCount = true,
}: TagFilterProps) {
  if (!tags || tags.length === 0) {
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
          onClick={() => onTagSelect(null)}
          className={cn(
            "rounded-full font-semibold transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
            sizeClasses[size],
            selectedTagId === null
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          )}
        >
          すべて
        </button>
        {tags.map((tag) => {
          const itemCount = tagItemCounts?.get(tag.id) ?? 0
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => onTagSelect(tag.id === selectedTagId ? null : tag.id)}
              className={cn(
                "rounded-full font-semibold transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                sizeClasses[size],
                selectedTagId === tag.id
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              )}
            >
              {tag.name}
              {showItemCount && (
                <span className="ml-1 opacity-70">({itemCount})</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

