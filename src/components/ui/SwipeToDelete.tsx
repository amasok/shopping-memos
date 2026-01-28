"use client"

import { cn } from "@/lib/utils"
import { Trash2, Undo2 } from "lucide-react"
import { useRef, useState } from "react"

interface SwipeToDeleteProps {
  children: React.ReactNode
  onDelete: () => void
  deleteLabel?: string
  deleteIcon?: React.ReactNode
  threshold?: number
  className?: string
}

export function SwipeToDelete({
  children,
  onDelete,
  deleteLabel = "削除",
  deleteIcon = <Trash2 className="h-5 w-5" />,
  threshold = 80,
  className,
}: SwipeToDeleteProps) {
  const [translateX, setTranslateX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startX = useRef(0)
  const currentX = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    currentX.current = e.touches[0].clientX
    setIsDragging(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return

    currentX.current = e.touches[0].clientX
    const diff = currentX.current - startX.current

    // 左方向のみ許可（削除方向）
    if (diff < 0) {
      setTranslateX(Math.max(diff, -150))
    } else {
      setTranslateX(0)
    }
  }

  const handleTouchEnd = () => {
    setIsDragging(false)

    if (translateX < -threshold) {
      // 閾値を超えたら削除アクション
      setTranslateX(-150)
      // 少し待ってから削除を実行
      setTimeout(() => {
        onDelete()
        setTranslateX(0)
      }, 200)
    } else {
      // 戻す
      setTranslateX(0)
    }
  }

  const showDelete = translateX < -20

  return (
    <div ref={containerRef} className={cn("relative overflow-hidden", className)}>
      {/* 削除アクション背景 */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex items-center justify-end",
          "bg-red-500 text-white",
          "transition-opacity duration-200",
          showDelete ? "opacity-100" : "opacity-0"
        )}
        style={{ width: Math.abs(translateX) }}
      >
        <div className="flex items-center gap-2 px-4">
          {deleteIcon}
          <span className="text-sm font-medium">{deleteLabel}</span>
        </div>
      </div>

      {/* コンテンツ */}
      <div
        className={cn(
          "relative bg-white",
          !isDragging && "transition-transform duration-200"
        )}
        style={{ transform: `translateX(${translateX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  )
}

// リストから外す用（買いたいものに戻す）
interface SwipeToRemoveProps {
  children: React.ReactNode
  onRemove: () => void
  removeLabel?: string
  threshold?: number
  className?: string
}

export function SwipeToRemove({
  children,
  onRemove,
  removeLabel = "外す",
  threshold = 80,
  className,
}: SwipeToRemoveProps) {
  const [translateX, setTranslateX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startX = useRef(0)
  const currentX = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    currentX.current = e.touches[0].clientX
    setIsDragging(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return

    currentX.current = e.touches[0].clientX
    const diff = currentX.current - startX.current

    // 左方向のみ許可
    if (diff < 0) {
      setTranslateX(Math.max(diff, -150))
    } else {
      setTranslateX(0)
    }
  }

  const handleTouchEnd = () => {
    setIsDragging(false)

    if (translateX < -threshold) {
      setTranslateX(-150)
      setTimeout(() => {
        onRemove()
        setTranslateX(0)
      }, 200)
    } else {
      setTranslateX(0)
    }
  }

  const showRemove = translateX < -20

  return (
    <div ref={containerRef} className={cn("relative overflow-hidden", className)}>
      {/* 外すアクション背景 */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex items-center justify-end",
          "bg-orange-500 text-white",
          "transition-opacity duration-200",
          showRemove ? "opacity-100" : "opacity-0"
        )}
        style={{ width: Math.abs(translateX) }}
      >
        <div className="flex items-center gap-2 px-4">
          <Undo2 className="h-5 w-5" />
          <span className="text-sm font-medium">{removeLabel}</span>
        </div>
      </div>

      {/* コンテンツ */}
      <div
        className={cn(
          "relative bg-white",
          !isDragging && "transition-transform duration-200"
        )}
        style={{ transform: `translateX(${translateX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  )
}
