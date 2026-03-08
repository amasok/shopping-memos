"use client"

import { extractFirstUrl, splitByUrls } from "@/lib/url"
import { cn } from "@/lib/utils"
import { OGPPreview } from "./OGPPreview"

interface MemoTextProps {
  memo: string
  className?: string
  checked?: boolean
}

export function MemoText({ memo, className, checked = false }: MemoTextProps) {
  const segments = splitByUrls(memo)
  const firstUrl = extractFirstUrl(memo)

  return (
    <div>
      <p className={cn("break-all", className)}>
        {segments.map((segment, i) => {
          if (segment.type === "url") {
            return (
              <a
                key={i}
                href={segment.value}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "text-blue-600 underline underline-offset-2 hover:text-blue-800",
                  checked && "line-through opacity-70"
                )}
              >
                {segment.value}
              </a>
            )
          }
          return <span key={i}>{segment.value}</span>
        })}
      </p>
      {firstUrl && <OGPPreview url={firstUrl} checked={checked} />}
    </div>
  )
}
