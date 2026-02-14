import { cn } from "@/lib/utils"
import { type HTMLAttributes } from "react"

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({
  className,
  icon,
  title,
  description,
  action,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 text-center",
        className
      )}
      data-testid="empty-state"
      {...props}
    >
      {icon && (
        <div className="mb-4 text-gray-400">
          {icon}
        </div>
      )}
      <h3 className="text-xl font-bold text-gray-900">{title}</h3>
      {description && (
        <p className="mt-2 text-base text-gray-600">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
