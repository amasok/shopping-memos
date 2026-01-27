import { cn } from "@/lib/utils"
import { type ButtonHTMLAttributes, forwardRef } from "react"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger"
  size?: "sm" | "md" | "lg"
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center rounded-lg font-medium transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-offset-2",
          "disabled:pointer-events-none disabled:opacity-50",
          // Size variants
          size === "sm" && "min-h-[36px] px-3 text-sm",
          size === "md" && "min-h-[44px] px-4 text-base",
          size === "lg" && "min-h-[52px] px-6 text-lg",
          // Color variants
          variant === "primary" &&
            "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500",
          variant === "secondary" &&
            "bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-500",
          variant === "ghost" &&
            "bg-transparent text-gray-600 hover:bg-gray-100 focus:ring-gray-500",
          variant === "danger" &&
            "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
          className
        )}
        {...props}
      />
    )
  }
)

Button.displayName = "Button"
