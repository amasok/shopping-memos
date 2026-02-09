"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"

export type ThemeType = "orange" | "terracotta" | "coral" | "blue"

export const THEMES: { id: ThemeType; name: string; description: string; color: string }[] = [
  { id: "orange", name: "オレンジ", description: "明るく元気", color: "#f97316" },
  { id: "terracotta", name: "テラコッタ", description: "落ち着き・ナチュラル", color: "#d97706" },
  { id: "coral", name: "コーラル", description: "かわいい・モダン", color: "#f43f5e" },
  { id: "blue", name: "ブルー", description: "クール・クラシック", color: "#3b82f6" },
]

const STORAGE_KEY = "theme"
const DEFAULT_THEME: ThemeType = "orange"

type ThemeContextType = {
  theme: ThemeType
  setTheme: (theme: ThemeType) => void
  isHydrated: boolean
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  // サーバーとクライアントで同じ初期値を使用してハイドレーションエラーを防ぐ
  const [theme, setThemeState] = useState<ThemeType>(DEFAULT_THEME)
  const [isHydrated, setIsHydrated] = useState(false)

  // クライアントサイドでのみlocalStorageから読み込み
  // SSRとの整合性のため、マウント後にlocalStorageを読み込んでstateを更新する必要がある
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeType | null
    if (stored && THEMES.some((t) => t.id === stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR後のクライアント初期化に必要
      setThemeState(stored)
      document.documentElement.setAttribute("data-theme", stored)
    } else {
      document.documentElement.setAttribute("data-theme", DEFAULT_THEME)
    }
    setIsHydrated(true)
  }, [])

  // テーマ変更時にDOM属性を更新
  useEffect(() => {
    if (isHydrated) {
      document.documentElement.setAttribute("data-theme", theme)
    }
  }, [theme, isHydrated])

  // テーマ変更
  const setTheme = useCallback((newTheme: ThemeType) => {
    setThemeState(newTheme)
    localStorage.setItem(STORAGE_KEY, newTheme)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isHydrated }}>
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
