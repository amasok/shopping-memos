"use client"

import { cn } from "@/lib/utils"
import { X } from "lucide-react"
import {
  type ReactNode,
  useEffect,
  useState,
  type MouseEvent,
} from "react"

export interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

export function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
}: BottomSheetProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  // isOpenの状態変化に基づいてアニメーション状態を同期
  const [prevIsOpen, setPrevIsOpen] = useState(false)
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen)
    if (isOpen) {
      setIsVisible(true)
    } else {
      setIsAnimating(false)
    }
  }

  // アニメーション開始とクリーンアップ
  useEffect(() => {
    if (isOpen && isVisible) {
      // 少し遅延させてアニメーションを開始
      const frameId = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAnimating(true)
        })
      })
      return () => cancelAnimationFrame(frameId)
    }
  }, [isOpen, isVisible])

  // 閉じるアニメーション完了後に非表示
  useEffect(() => {
    if (!isOpen && isVisible) {
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen, isVisible])

  // ESCキーで閉じる
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose()
      }
    }
    window.addEventListener("keydown", handleEsc)
    return () => window.removeEventListener("keydown", handleEsc)
  }, [isOpen, onClose])

  // スクロール防止
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [isOpen])

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!isVisible) return null

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-end justify-center",
        "transition-colors duration-300",
        isAnimating ? "bg-black/50" : "bg-black/0"
      )}
      onClick={handleBackdropClick}
    >
      <div
        className={cn(
          "w-full max-w-lg rounded-t-2xl bg-white shadow-xl",
          "transform transition-transform duration-300 ease-out",
          "max-h-[85vh] overflow-hidden flex flex-col",
          isAnimating ? "translate-y-0" : "translate-y-full"
        )}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">
            {title || ""}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
