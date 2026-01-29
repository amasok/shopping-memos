"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { Button } from "./Button"

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: "primary" | "danger"
}

/**
 * 確認ダイアログ
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "確認",
  cancelLabel = "キャンセル",
  confirmVariant = "primary",
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (isOpen) {
      dialog.showModal()
    } else {
      dialog.close()
    }
  }, [isOpen])

  const handleConfirm = () => {
    onConfirm()
    onClose()
  }

  if (!isOpen) return null

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        "fixed inset-0 z-50 m-auto",
        "w-[calc(100%-2rem)] max-w-sm rounded-xl bg-white p-0 shadow-xl",
        "backdrop:bg-black/50"
      )}
      onClose={onClose}
    >
      <div className="p-6">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
      </div>
      <div className="flex gap-3 border-t border-gray-100 p-4">
        <Button
          variant="ghost"
          className="flex-1"
          onClick={onClose}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={confirmVariant === "danger" ? "ghost" : "primary"}
          className={cn(
            "flex-1",
            confirmVariant === "danger" && "text-red-600 hover:bg-red-50 hover:text-red-700"
          )}
          onClick={handleConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
