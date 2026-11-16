import { redirect } from "next/navigation"
import { listDetailHref } from "@/lib/routes"

/** 旧 URL（/lists/<id>）のブックマーク対策。/lists/detail?id=<id> に移す */
export default async function LegacyListPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(listDetailHref(id))
}
