// @vitest-environment node
import { readFileSync } from "fs"
import path from "path"
import { parse } from "yaml"
import { describe, it, expect } from "vitest"

/**
 * CI ワークフロー（.github/workflows/ci.yml）の E2E ジョブ構成を検証する。
 *
 * Issue #74: ログイン済み E2E（e2e/auth）は実DBに接続するが、
 * CI の E2E ジョブはダミーの DATABASE_URL のまま実行されていたため、
 * main の CI が失敗し続けていた。同じ問題の再発を防ぐ。
 */

type Step = { name?: string; run?: string }
type Job = {
  "runs-on"?: string
  needs?: string | string[]
  if?: string
  "timeout-minutes"?: number
  services?: Record<string, { image?: string; env?: Record<string, string> }>
  env?: Record<string, string>
  steps: Step[]
}
type Workflow = {
  permissions?: Record<string, string>
  concurrency?: { group?: string; "cancel-in-progress"?: string | boolean }
  jobs: Record<string, Job>
}

const workflow = parse(
  readFileSync(
    path.resolve(__dirname, "../../.github/workflows/ci.yml"),
    "utf-8"
  )
) as Workflow
const e2e = workflow.jobs.e2e

function stepIndex(command: string): number {
  return e2e.steps.findIndex((s) => s.run?.includes(command))
}

describe("CI ワークフローの E2E ジョブ", () => {
  it("E2E ジョブが定義されている", () => {
    expect(e2e).toBeDefined()
  })

  it("Postgres サービスを起動する", () => {
    const images = Object.values(e2e.services ?? {}).map((s) => s.image ?? "")
    expect(images.some((image) => image.startsWith("postgres"))).toBe(true)
  })

  it("DATABASE_URL がダミーではなく Postgres サービスを指す", () => {
    const url = e2e.env?.DATABASE_URL ?? ""
    expect(url).toMatch(/^postgres(ql)?:\/\/.+@localhost:5432\//)
    expect(url).not.toContain("dummy")
  })

  it("Auth.js に必要な AUTH_SECRET が設定されている", () => {
    expect(e2e.env?.AUTH_SECRET?.length ?? 0).toBeGreaterThan(0)
  })

  it("E2E 実行前にマイグレーションを適用する", () => {
    const migrate = stepIndex("db:migrate")
    const runE2E = stepIndex("test:e2e")
    expect(migrate).toBeGreaterThanOrEqual(0)
    expect(runE2E).toBeGreaterThan(migrate)
  })

  it("E2E 実行前に本番ビルドを作成する", () => {
    const build = stepIndex("npm run build")
    const runE2E = stepIndex("test:e2e")
    expect(build).toBeGreaterThanOrEqual(0)
    expect(runE2E).toBeGreaterThan(build)
  })

  it("next start で Auth.js が localhost を信頼する（AUTH_TRUST_HOST）", () => {
    expect(e2e.env?.AUTH_TRUST_HOST).toBe("true")
  })

  it("playwright.config.ts が CI では本番ビルド（npm run start）で起動する", () => {
    const config = readFileSync(
      path.resolve(__dirname, "../../playwright.config.ts"),
      "utf-8"
    )
    expect(config).toContain("process.env.CI")
    expect(config).toContain("E2E_TEST=true npm run start")
    expect(config).toContain("E2E_TEST=true npm run dev")
  })

  it("本番DBマイグレーション（migrate ジョブ）に依存しない", () => {
    const needs = [e2e.needs ?? []].flat()
    expect(needs).not.toContain("migrate")
  })

  it("PR でも実行され、main マージ前に失敗を検知できる", () => {
    expect(e2e.if ?? "").toContain("pull_request")
  })

  it("Playwright が対応する OS バージョンに固定されている", () => {
    // ubuntu-latest は OS 更新で Playwright 未対応になり得る（26.04 で発生）
    expect(e2e["runs-on"]).toMatch(/^ubuntu-\d{2}\.\d{2}$/)
  })

  it("ジョブにタイムアウトが設定されている", () => {
    expect(e2e["timeout-minutes"]).toBeGreaterThan(0)
  })
})

describe("CI ワークフロー全体の設定", () => {
  it("GITHUB_TOKEN の権限を contents: read に絞る", () => {
    expect(workflow.permissions).toEqual({ contents: "read" })
  })

  it("古い実行を止めるが、main では止めない", () => {
    expect(workflow.concurrency?.group).toContain("github.ref")
    // main は commit ごとに別 group にし、待機中の実行が置き換えで取り消されないようにする
    expect(workflow.concurrency?.group).toContain("github.sha")
    expect(String(workflow.concurrency?.["cancel-in-progress"])).toContain(
      "refs/heads/main"
    )
  })
})
