"use client"

import { cn } from "@/lib/utils"
import { Check } from "lucide-react"
import { type InputHTMLAttributes, forwardRef } from "react"

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string
  strikethrough?: boolean
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, checked, strikethrough = false, id, ...props }, ref) => {
    const checkboxId = id || props.name

    return (
      <label
        htmlFor={checkboxId}
        className={cn(
          "inline-flex min-h-[44px] cursor-pointer items-center gap-3",
          props.disabled && "cursor-not-allowed opacity-50",
          className
        )}
      >
        <div className="relative">
          <input
            ref={ref}
            type="checkbox"
            id={checkboxId}
            checked={checked}
            className="peer sr-only"
            {...props}
          />
          <div
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-lg border-2 transition-all",
              checked ? "border-transparent" : "border-gray-300 bg-white"
            )}
            style={
              checked
                ? { backgroundColor: "var(--theme-primary)", borderColor: "var(--theme-primary)" }
                : undefined
            }
          >
            {checked && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
          </div>
        </div>
        {label && (
          <span
            className={cn(
              "text-base font-medium text-gray-900",
              strikethrough && checked && "text-gray-400 line-through"
            )}
          >
            {label}
          </span>
        )}
      </label>
    )
  }
)

Checkbox.displayName = "Checkbox"
