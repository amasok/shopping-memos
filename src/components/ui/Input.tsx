import { cn } from "@/lib/utils"
import { type InputHTMLAttributes, forwardRef } from "react"

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const inputId = id || props.name

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-2 block text-base font-semibold text-gray-900"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "w-full rounded-lg border-2 px-4 py-3",
            "text-lg font-semibold text-gray-900",
            "placeholder:font-normal placeholder:text-gray-400",
            "transition-colors",
            "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
            "disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500",
            error
              ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
              : "border-gray-300",
            className
          )}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="mt-1.5 text-sm font-medium text-red-600">
            {error}
          </p>
        )}
      </div>
    )
  }
)

Input.displayName = "Input"
