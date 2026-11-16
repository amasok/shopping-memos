"use client"

import { useSerwist } from "@serwist/turbopack/react"
import { useServiceWorkerUpdate } from "@/hooks/useServiceWorkerUpdate"
import { UpdateAvailableToast } from "./UpdateAvailableToast"
import { ForceUpdateModal } from "./ForceUpdateModal"

/** SerwistProvider の内側に置く。更新通知トーストと強制更新モーダルを出す */
export function SWUpdateManager() {
  const { serwist } = useSerwist()
  const { waiting, applyUpdate } = useServiceWorkerUpdate(serwist)
  return (
    <>
      {waiting && <UpdateAvailableToast onUpdate={applyUpdate} />}
      <ForceUpdateModal serwist={serwist} />
    </>
  )
}
