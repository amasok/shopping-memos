"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { initializeDefaultTags } from "./tags"

interface DBContextValue {
  isReady: boolean
}

const DBContext = createContext<DBContextValue>({ isReady: false })

export function useDB() {
  return useContext(DBContext)
}

export function DBProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    async function init() {
      try {
        await initializeDefaultTags()
        setIsReady(true)
      } catch (error) {
        console.error("Failed to initialize database:", error)
        setIsReady(true) // エラーでも続行
      }
    }
    init()
  }, [])

  return (
    <DBContext.Provider value={{ isReady }}>
      {children}
    </DBContext.Provider>
  )
}
