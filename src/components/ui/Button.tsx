import { cn } from "@/lib/utils"
import { type ButtonHTMLAttributes, forwardRef } from "react"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger"
  size?: "sm" | "md" | "lg"
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, style, ...props }, ref) => {
    const isPrimary = variant === "primary"

    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center rounded-xl font-semibold transition-all",
          "focus:outline-none focus:ring-2 focus:ring-offset-2",
          "disabled:pointer-events-none disabled:opacity-50",
          "active:scale-[0.98]",
          // Size variants
          size === "sm" && "min-h-[36px] px-3 text-sm",
          size === "md" && "min-h-[48px] px-5 text-base",
          size === "lg" && "min-h-[56px] px-6 text-lg",
          // Color variants
          isPrimary && "text-white shadow-md hover:shadow-lg",
          variant === "secondary" &&
            "bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-400",
          variant === "ghost" &&
            "bg-transparent text-gray-600 hover:bg-gray-100 focus:ring-gray-400",
          variant === "danger" &&
            "bg-red-500 text-white hover:bg-red-600 focus:ring-red-400 shadow-md",
          className
        )}
        style={
          isPrimary
            ? {
                backgroundColor: "var(--theme-primary)",
                ...style,
              }
            : style
        }
        onMouseEnter={(e) => {
          if (isPrimary && !disabled) {
            e.currentTarget.style.backgroundColor = "var(--theme-primary-hover)"
          }
          props.onMouseEnter?.(e)
        }}
        onMouseLeave={(e) => {
          if (isPrimary && !disabled) {
            e.currentTarget.style.backgroundColor = "var(--theme-primary)"
          }
          props.onMouseLeave?.(e)
        }}
        {...props}
      />
    )
  }
)

Button.displayName = "Button"
