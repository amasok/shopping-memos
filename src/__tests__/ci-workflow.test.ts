// @vitest-environment node
import { readFileSync } from "fs"
import { spawnSync } from "child_process"
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

type Step = { name?: string; run?: string; uses?: string; if?: string; env?: Record<string, string> }
type Job = {
  "runs-on"?: string
  needs?: string | string[]
  if?: string
  "timeout-minutes"?: number
  environment?: string
  concurrency?: { group?: string; "cancel-in-progress"?: string | boolean }
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
    expect(config).toContain("E2E_BUILD=true E2E_TEST=true npm run dev")
  })

  it("E2E 用のビルドは E2E_BUILD=true で作成する（E2E 専用ルートを含める。#70）", () => {
    const build = e2e.steps[stepIndex("npm run build")]
    expect(build.env?.E2E_BUILD ?? "").toBe("true")
  })

  it("通常の Build ジョブは E2E_BUILD を設定しない（本番相当のビルドに E2E 専用ルートを含めない）", () => {
    const build = workflow.jobs.build
    expect(build.env?.E2E_BUILD).toBeUndefined()
    for (const step of build.steps) {
      expect(step.env?.E2E_BUILD).toBeUndefined()
      expect(step.run ?? "").not.toContain("E2E_BUILD")
    }
  })

  it("E2E 実行前に x-e2e-token 用の E2E_SEED_TOKEN をランダムに生成する", () => {
    const token = e2e.steps.findIndex((s) => s.run?.includes("E2E_SEED_TOKEN="))
    expect(token).toBeGreaterThanOrEqual(0)
    expect(e2e.steps[token].run).toContain("openssl rand")
    expect(token).toBeLessThan(stepIndex("test:e2e"))
    // 固定値をワークフローに書かない
    expect(e2e.env?.E2E_SEED_TOKEN).toBeUndefined()
  })

  it("playwright.config.ts は E2E_SEED_TOKEN が未設定ならランダムに生成する", () => {
    const config = readFileSync(
      path.resolve(__dirname, "../../playwright.config.ts"),
      "utf-8"
    )
    expect(config).toContain("process.env.E2E_SEED_TOKEN ||= randomBytes(32)")
  })

  it("通常の E2E の後に offline プロジェクトを E2E_OFFLINE=true で実行する", () => {
    const runE2E = stepIndex("test:e2e")
    const offline = stepIndex("--project=offline")
    expect(offline).toBeGreaterThan(runE2E)
    expect(e2e.steps[offline].run).toContain("E2E_OFFLINE=true")
  })

  it("playwright.config.ts の offline プロジェクトは E2E_OFFLINE のときだけ有効（通常の test:e2e に混ざらない）", () => {
    const config = readFileSync(
      path.resolve(__dirname, "../../playwright.config.ts"),
      "utf-8"
    )
    expect(config).toMatch(/process\.env\.E2E_OFFLINE\s*\?\s*\[\s*\{\s*name: "offline"/)
    expect(config).toContain("npx next start -p 3100")
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

describe("本番DBマイグレーション（migrate ジョブ）(#94)", () => {
  const migrate = workflow.jobs.migrate
  const migrateStep = () => migrate.steps.find((s) => s.run?.includes("db:migrate"))

  it("main への push だけで、production 環境のシークレットを使って実行する", () => {
    expect(migrate.if).toBe("github.ref == 'refs/heads/main'")
    expect(migrate.environment).toBe("production")
    expect(migrateStep()?.env?.DATABASE_URL).toBe("${{ secrets.NEON_DATABASE_URL }}")
  })

  it("本番DBへの migrate は、job 単位の concurrency で常に 1 本ずつ実行し、実行中のものは取り消さない", () => {
    expect(migrate.concurrency?.group).toBe("migrate-production")
    // github.ref や github.sha を含めると、commit・ブランチごとに別 group になり直列にならない
    expect(migrate.concurrency?.group).not.toContain("${{")
    expect(migrate.concurrency?.["cancel-in-progress"]).toBe(false)
  })

  it("変更の有無（paths-filter）で判定せず、毎回 db:migrate を実行する（取り消された実行の分も次で適用される）", () => {
    expect(migrate.steps.some((s) => s.uses?.startsWith("dorny/paths-filter"))).toBe(false)
    const step = migrateStep()
    expect(step).toBeDefined()
    expect(step?.if).toBeUndefined()
    for (const s of migrate.steps) expect(s.if ?? "").not.toContain("steps.changes")
  })

  it("ビルドが通ってから実行する", () => {
    expect([migrate.needs ?? []].flat()).toContain("build")
  })
})

describe("develop 用 DB のマイグレーション（migrate-develop ジョブ）(#134)", () => {
  const job = workflow.jobs["migrate-develop"]
  const migrateStep = () => job.steps.find((s) => s.run?.includes("db:migrate"))

  it("develop への push のときだけ実行する（PR や main では動かない）", () => {
    expect(job).toBeDefined()
    expect(job.if).toContain("github.ref == 'refs/heads/develop'")
    expect(job.if).toContain("github.event_name == 'push'")
  })

  it("DEVELOP_DATABASE_URL を使い、本番の secret は使わない", () => {
    expect(migrateStep()?.env?.DATABASE_URL).toBe("${{ secrets.DEVELOP_DATABASE_URL }}")
    expect(JSON.stringify(job)).not.toContain("NEON_DATABASE_URL")
    expect(job.environment).toBeUndefined()
  })

  it("本番と同じく、job 単位の concurrency で 1 本ずつ実行し、実行中のものは取り消さない", () => {
    expect(job.concurrency?.group).toBe("migrate-develop")
    expect(job.concurrency?.["cancel-in-progress"]).toBe(false)
    expect(job.concurrency?.group).not.toBe(workflow.jobs.migrate.concurrency?.group)
  })

  it("secret が未設定なら、migrate の前に明確なメッセージで失敗する", () => {
    const check = job.steps.findIndex((s) => s.env?.DATABASE_URL === "${{ secrets.DEVELOP_DATABASE_URL }}" && !s.run?.includes("db:migrate"))
    expect(check).toBeGreaterThanOrEqual(0)
    expect(check).toBeLessThan(job.steps.findIndex((s) => s.run?.includes("db:migrate")))
    const run = job.steps[check].run ?? ""
    expect(run).toContain('-z "$DATABASE_URL"')
    expect(run).toContain("DEVELOP_DATABASE_URL")
    expect(run).toContain("exit 1")
  })

  it("確認のスクリプトは、secret が空なら失敗してメッセージを出し、設定されていれば通る", () => {
    const run = job.steps.find((s) => s.name === "Check DEVELOP_DATABASE_URL")?.run ?? ""
    const exec = (value: string) =>
      spawnSync("bash", ["-e", "-c", run], { env: { ...process.env, DATABASE_URL: value }, encoding: "utf-8" })
    const missing = exec("")
    expect(missing.status).toBe(1)
    expect(missing.stdout).toContain("::error title=DEVELOP_DATABASE_URL is not set::")
    expect(exec("postgresql://u:p@host/db").status).toBe(0)
  })

  it("変更の有無で判定せず毎回 db:migrate を実行し、ビルドが通ってから動く", () => {
    expect(job.steps.some((s) => s.uses?.startsWith("dorny/paths-filter"))).toBe(false)
    expect(migrateStep()?.if).toBeUndefined()
    expect([job.needs ?? []].flat()).toContain("build")
  })
})

describe("CI ワークフロー全体の設定", () => {
  it("GITHUB_TOKEN の権限を contents: read に絞る", () => {
    expect(workflow.permissions).toEqual({ contents: "read" })
  })

  it("古い実行を止めるが、main と develop では止めない（migrate の途中で取り消さない。#134）", () => {
    expect(workflow.concurrency?.group).toContain("github.ref")
    // main と develop は commit ごとに別 group にし、待機中の実行が置き換えで取り消されないようにする
    expect(workflow.concurrency?.group).toContain("github.sha")
    const cancel = String(workflow.concurrency?.["cancel-in-progress"])
    expect(cancel).toContain("github.ref != 'refs/heads/main'")
    expect(cancel).toContain("github.ref != 'refs/heads/develop'")
    expect(workflow.concurrency?.group).toContain("refs/heads/develop")
  })
})

describe("SW ライフサイクル E2E のワークフロー（sw-e2e.yml）", () => {
  const swWorkflow = parse(
    readFileSync(
      path.resolve(__dirname, "../../.github/workflows/sw-e2e.yml"),
      "utf-8"
    )
  ) as {
    on: {
      pull_request?: { paths?: string[] }
      push?: unknown
      workflow_dispatch?: unknown
    }
    jobs: Record<string, Job>
  }

  it("SW 関連のファイルが変わった PR と手動実行のときだけ動く（push や全 PR では動かない）", () => {
    expect(swWorkflow.on.push).toBeUndefined()
    expect(swWorkflow.on).toHaveProperty("workflow_dispatch")
    const paths = swWorkflow.on.pull_request?.paths ?? []
    for (const p of [
      "src/app/sw*.ts",
      "src/lib/sw/**",
      "src/components/pwa/**",
      "src/app/serwist/**",
      "next.config.ts",
      "package.json",
      "package-lock.json",
      "playwright.config.ts",
      "src/hooks/useServiceWorkerUpdate.ts",
      "src/app/api/version/**",
      "src/app/layout.tsx",
    ]) {
      expect(paths).toContain(p)
    }
  })

  it("npm run test:e2e:sw-lifecycle を実行し、タイムアウトと OS 固定がある", () => {
    const job = Object.values(swWorkflow.jobs)[0]
    expect(job.steps.some((s) => s.run?.includes("test:e2e:sw-lifecycle"))).toBe(true)
    expect(job["timeout-minutes"]).toBeGreaterThan(0)
    expect(job["runs-on"]).toMatch(/^ubuntu-\d{2}\.\d{2}$/)
  })
})
