"use client"

import { createContext, useContext, useState, useLayoutEffect, useCallback, useRef, type ReactNode } from "react"

export type ThemeType = "orange" | "terracotta" | "coral" | "blue"

export const THEMES: { id: ThemeType; name: string; description: string; color: string }[] = [
  { id: "orange", name: "オレンジ", description: "明るく元気", color: "#f97316" },
  { id: "terracotta", name: "テラコッタ", description: "落ち着き・ナチュラル", color: "#d97706" },
  { id: "coral", name: "コーラル", description: "かわいい・モダン", color: "#f43f5e" },
  { id: "blue", name: "ブルー", description: "クール・クラシック", color: "#3b82f6" },
]

const STORAGE_KEY = "theme"
const DEFAULT_THEME: ThemeType = "orange"

// localStorageから初期テーマを取得（クライアントサイドのみ）
function getInitialTheme(): ThemeType {
  if (typeof window === "undefined") return DEFAULT_THEME
  const stored = localStorage.getItem(STORAGE_KEY) as ThemeType | null
  if (stored && THEMES.some((t) => t.id === stored)) {
    return stored
  }
  return DEFAULT_THEME
}

type ThemeContextType = {
  theme: ThemeType
  setTheme: (theme: ThemeType) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 遅延初期化でlocalStorageから読み込み
  const [theme, setThemeState] = useState<ThemeType>(getInitialTheme)
  const isInitialized = useRef(false)

  // DOM属性の初期設定（useLayoutEffectで同期的に実行）
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    isInitialized.current = true
  }, [theme])

  // テーマ変更
  const setTheme = useCallback((newTheme: ThemeType) => {
    setThemeState(newTheme)
    localStorage.setItem(STORAGE_KEY, newTheme)
    document.documentElement.setAttribute("data-theme", newTheme)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}
