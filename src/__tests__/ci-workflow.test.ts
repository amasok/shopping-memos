// @vitest-environment node
import { readFileSync } from "fs"
import { spawnSync } from "child_process"
import { mkdtempSync, writeFileSync, chmodSync } from "fs"
import { tmpdir } from "os"
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
type Trigger = { branches?: string[]; paths?: string[]; "paths-ignore"?: string[] }
type Workflow = {
  on: { push?: Trigger; pull_request?: Trigger }
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
    // ポートは E2E_OFFLINE_PORT（既定 3100）。解決された値は playwright-config.test.ts で確かめる（#142）
    expect(config).toContain("npx next start -p ${E2E_OFFLINE_PORT}")
  })

  it("本番DBマイグレーション（migrate ジョブ）に依存しない", () => {
    const needs = [e2e.needs ?? []].flat()
    expect(needs).not.toContain("migrate")
  })

  it("main への PR と main への push だけで実行する（develop への PR では動かさない。#142）", () => {
    expect(e2e.if).toBe(
      "(github.event_name == 'pull_request' && github.base_ref == 'main') || (github.event_name == 'push' && github.ref == 'refs/heads/main')"
    )
  })

  describe("実行する Playwright のプロジェクト（#142）", () => {
    const runStep = () => e2e.steps[stepIndex("test:e2e")]

    /** E2E の run を、npm を引数を出力するだけの偽物に差し替えて実行し、渡されたプロジェクトを返す */
    function projectsFor(ref: string): string[] {
      const bin = mkdtempSync(path.join(tmpdir(), "fake-npm-"))
      writeFileSync(path.join(bin, "npm"), '#!/bin/bash\nfor a in "$@"; do echo "$a"; done\n')
      chmodSync(path.join(bin, "npm"), 0o755)
      const result = spawnSync("bash", ["-e", "-c", runStep().run ?? ""], {
        env: { ...process.env, ...runStep().env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REF: ref },
        encoding: "utf-8",
      })
      expect(result.status, result.stderr).toBe(0)
      return result.stdout
        .split("\n")
        .filter((a) => a.startsWith("--project="))
        .map((a) => a.slice("--project=".length))
    }

    it("式を run に直接埋め込まない", () => {
      expect(runStep().run ?? "").not.toContain("${{")
    })

    it.each([["refs/pull/2/merge"], ["refs/heads/main"]])(
      "E2E ジョブが動くとき（main への PR と push）は、Mobile Chrome も含めて全部流す（%s）",
      (ref) => {
        expect(projectsFor(ref)).toEqual(["chromium", "chromium-auth", "Mobile Chrome"])
      }
    )

    it("npm run test:e2e:local と同じプロジェクトを流し、ローカルではログイン済みを 1 ワーカーにする", () => {
      const script = readFileSync(path.resolve(__dirname, "../../scripts/e2e-local.sh"), "utf-8")
      for (const name of ["chromium", "chromium-auth", "Mobile Chrome"]) {
        expect(script).toContain(`--project=${name.includes(" ") ? `"${name}"` : name}`)
      }
      // ログイン済みのテストは同じユーザーを共有するので、並列だと干渉する（CI は workers: 1）
      expect(script).toContain("--project=chromium-auth --workers=1")
    })

    it("指定するプロジェクト名が playwright.config.ts に存在する", () => {
      const config = readFileSync(path.resolve(__dirname, "../../playwright.config.ts"), "utf-8")
      for (const name of ["chromium", "chromium-auth", "Mobile Chrome"]) {
        expect(config).toContain(`name: "${name}"`)
      }
    })
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

  it("変更の有無で判定せず毎回 db:migrate を実行する", () => {
    expect(job.steps.some((s) => s.uses?.startsWith("dorny/paths-filter"))).toBe(false)
    expect(migrateStep()?.if).toBeUndefined()
  })

  it("develop への push では Build を動かさないので、build に依存せず、npm ci と db:migrate だけを行う（Actions の使用量削減）", () => {
    expect(job.needs).toBeUndefined()
    const runs = job.steps.map((s) => s.run ?? "").join("\n")
    expect(runs).toContain("npm ci")
    expect(runs).toContain("npm run db:migrate")
    expect(runs).not.toContain("npm run build")
    expect(runs).not.toContain("test")
  })
})

/**
 * GitHub Actions の paths の評価を真似る（後に書いたパターンほど優先。! で除外）。
 * `**` は / を含む任意の文字列、`*` は / を含まない任意の文字列
 */
function globToRegExp(glob: string): RegExp {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?"
        i += 2
      } else {
        re += ".*"
        i += 1
      }
    } else if (c === "*") {
      re += "[^/]*"
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    }
  }
  return new RegExp(`^${re}$`)
}

function triggeredBy(paths: string[], file: string): boolean {
  let matched = false
  for (const pattern of paths) {
    const negated = pattern.startsWith("!")
    if (globToRegExp(negated ? pattern.slice(1) : pattern).test(file)) matched = !negated
  }
  return matched
}

describe("CI の起動条件（Actions の使用量削減）", () => {
  it.each([["push"], ["pull_request"]] as const)("%s は paths で絞り、paths-ignore は使わない", (event) => {
    const trigger = workflow.on[event]
    expect(trigger?.branches).toEqual(["main", "develop"])
    expect(trigger?.["paths-ignore"]).toBeUndefined()
    expect(trigger?.paths?.length ?? 0).toBeGreaterThan(0)
  })

  it("ルート直下の .md も明示して除外する（`**/` がディレクトリ 0 個に一致するかに頼らない）", () => {
    const paths = workflow.on.push?.paths ?? []
    expect(paths).toContain("!*.md")
    // AGENTS.md・CLAUDE.md を戻す行は、除外の行より後に置く
    expect(paths.indexOf("AGENTS.md")).toBeGreaterThan(paths.indexOf("!*.md"))
    expect(paths.indexOf("CLAUDE.md")).toBeGreaterThan(paths.indexOf("!*.md"))
  })

  it.each([
    ["docs/features/sharing.md", false],
    ["docs/ogp-link-preview.md", false],
    ["docs/images/flow.png", false],
    ["README.md", false],
    ["GEMINI.md", false],
    ["src/components/README.md", false],
    [".claude/rules/team-operation.md", false],
    [".claude/settings.json", false],
    // #122 の検査（repo-invariants.test.ts）の対象なので、変わったら CI を動かす
    ["AGENTS.md", true],
    ["CLAUDE.md", true],
    ["src/app/page.tsx", true],
    ["package.json", true],
    [".github/workflows/ci.yml", true],
    ["drizzle/0005_x.sql", true],
  ])("%s だけの変更で CI が動くか: %s", (file, expected) => {
    for (const event of ["push", "pull_request"] as const) {
      expect(triggeredBy(workflow.on[event]?.paths ?? [], file), `${event}`).toBe(expected)
    }
  })

  it("push と pull_request の paths は同じ", () => {
    expect(workflow.on.push?.paths).toEqual(workflow.on.pull_request?.paths)
  })

  it.each([["test"], ["build"]])("%s は PR と main への push だけで動く（develop への push では動かさない）", (name) => {
    expect(workflow.jobs[name].if).toBe("github.event_name == 'pull_request' || github.ref == 'refs/heads/main'")
  })

  it("本番の migrate は今のまま build の後に動く", () => {
    expect([workflow.jobs.migrate.needs ?? []].flat()).toContain("build")
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
      "playwright.config.ts",
      "src/hooks/useServiceWorkerUpdate.ts",
      "src/app/api/version/**",
      "src/app/layout.tsx",
    ]) {
      expect(paths).toContain(p)
    }
  })

  it("package.json と package-lock.json の変更だけでは動かさない（依存の更新ごとに 5〜7 分かかるため。手動実行は残す）", () => {
    const paths = swWorkflow.on.pull_request?.paths ?? []
    expect(paths).not.toContain("package.json")
    expect(paths).not.toContain("package-lock.json")
    expect(swWorkflow.on).toHaveProperty("workflow_dispatch")
  })

  it("npm run test:e2e:sw-lifecycle を実行し、タイムアウトと OS 固定がある", () => {
    const job = Object.values(swWorkflow.jobs)[0]
    expect(job.steps.some((s) => s.run?.includes("test:e2e:sw-lifecycle"))).toBe(true)
    expect(job["timeout-minutes"]).toBeGreaterThan(0)
    expect(job["runs-on"]).toMatch(/^ubuntu-\d{2}\.\d{2}$/)
  })
})
