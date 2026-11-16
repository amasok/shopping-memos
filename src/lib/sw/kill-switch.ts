import { CACHE_PREFIX } from "./config"

export function isSwEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SW_ENABLED !== "false"
}

/** kill switch 段階 1: 既存の登録をすべて解除し、sm- / serwist- のキャッシュを削除する */
export async function unregisterAllServiceWorkers(): Promise<void> {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister()))
  }
  if (typeof caches !== "undefined") {
    const names = await caches.keys()
    await Promise.all(
      names
        .filter((n) => n.startsWith("sm-") || n.startsWith("serwist-"))
        .map((n) => caches.delete(n))
    )
  }
}

export { CACHE_PREFIX }
