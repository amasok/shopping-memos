import { cn } from "@/lib/utils"

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg"
  className?: string
}

const sizeClasses = {
  sm: "h-5 w-5 border-2",
  md: "h-8 w-8 border-4",
  lg: "h-12 w-12 border-4",
}

export function LoadingSpinner({ size = "md", className }: LoadingSpinnerProps) {
  return (
    <div
      className={cn(
        "animate-spin rounded-full border-blue-600 border-t-transparent",
        sizeClasses[size],
        className
      )}
    />
  )
}

export function LoadingPage() {
  return (
    <div className="flex items-center justify-center py-12">
      <LoadingSpinner />
    </div>
  )
}
