import { cn } from "@/lib/utils"
import { type HTMLAttributes } from "react"

export interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export function PageContainer({
  className,
  children,
  ...props
}: PageContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full max-w-lg px-4 py-4", className)}
      {...props}
    >
      {children}
    </div>
  )
}
