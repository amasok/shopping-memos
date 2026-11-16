"use client"

import { Button } from "@/components/ui/Button"

interface UpdateAvailableToastProps {
  onUpdate: () => void
}

export function UpdateAvailableToast({ onUpdate }: UpdateAvailableToastProps) {
  return (
    <div
      role="status"
      data-testid="update-available-toast"
      className="fixed inset-x-4 bottom-20 z-50 flex items-center justify-between gap-3 rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"
    >
      <span>新しいバージョンがあります</span>
      <Button
        size="sm"
        onClick={onUpdate}
        data-testid="update-available-button"
      >
        更新
      </Button>
    </div>
  )
}
