"use client"

import { useQuery } from "@tanstack/react-query"
import { cn } from "@/lib/utils"

interface OGPData {
  url: string
  title?: string
  description?: string
  image?: string
  siteName?: string
}

interface OGPPreviewProps {
  url: string
  checked?: boolean
}

async function fetchOGP(url: string): Promise<OGPData> {
  const res = await fetch(`/api/ogp?url=${encodeURIComponent(url)}`)
  if (!res.ok) throw new Error("OGP fetch failed")
  return res.json()
}

function OGPSkeleton() {
  return (
    <div className="mt-2 flex gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 animate-pulse">
      <div className="h-16 w-16 shrink-0 rounded bg-gray-200" />
      <div className="flex-1 space-y-2 py-1">
        <div className="h-3 w-3/4 rounded bg-gray-200" />
        <div className="h-3 w-full rounded bg-gray-200" />
        <div className="h-3 w-1/3 rounded bg-gray-200" />
      </div>
    </div>
  )
}

export function OGPPreview({ url, checked = false }: OGPPreviewProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ogp", url],
    queryFn: () => fetchOGP(url),
    staleTime: 1000 * 60,
    retry: 0,
  })

  if (isLoading) return <OGPSkeleton />
  if (isError || !data) return null

  const hostname = (() => {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  })()

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      data-testid="ogp-preview"
      className={cn(
        "mt-2 flex gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3",
        "transition-colors hover:bg-gray-100",
        "block",
        checked && "opacity-50"
      )}
    >
      {data.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.image}
          alt={data.title ?? ""}
          className={cn(
            "h-16 w-16 shrink-0 rounded object-cover",
            checked && "grayscale"
          )}
          onError={(e) => {
            e.currentTarget.style.display = "none"
          }}
        />
      )}
      <div className="min-w-0 flex-1">
        {data.title && (
          <p
            className={cn(
              "text-sm font-semibold text-gray-900 line-clamp-1",
              checked && "line-through text-gray-500"
            )}
          >
            {data.title}
          </p>
        )}
        {data.description && (
          <p
            className={cn(
              "mt-0.5 text-xs text-gray-500 line-clamp-2",
              checked && "line-through"
            )}
          >
            {data.description}
          </p>
        )}
        <p className={cn("mt-1 text-xs text-gray-400", checked && "line-through")}>
          {data.siteName ? `${data.siteName} - ${hostname}` : hostname}
        </p>
      </div>
    </a>
  )
}
