// @vitest-environment node
import { readFileSync } from "fs"
import { spawnSync } from "child_process"
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "fs"
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
      rmSync(bin, { recursive: true, force: true })
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

  it("DEVELOP_DATABASE_URL を使い、本番の secret は比べるためだけに読む（migrate には使わない）", () => {
    expect(migrateStep()?.env?.DATABASE_URL).toBe("${{ secrets.DEVELOP_DATABASE_URL }}")
    const usesProduction = job.steps.filter((s) => JSON.stringify(s).includes("NEON_DATABASE_URL"))
    expect(usesProduction.map((s) => s.name)).toEqual(["Check DEVELOP_DATABASE_URL is not production"])
    expect(job.environment).toBeUndefined()
  })

  describe("DEVELOP_DATABASE_URL が本番を指していないかの確認 (#139)", () => {
    const step = () => job.steps.find((s) => s.name === "Check DEVELOP_DATABASE_URL is not production")
    const exec = (develop: string, production: string) =>
      spawnSync("bash", ["-e", "-c", step()?.run ?? ""], {
        env: { ...process.env, DEVELOP_URL: develop, PRODUCTION_URL: production },
        encoding: "utf-8",
      })
    const PROD = "postgresql://owner:secret-prod@ep-cool-name-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
    const DEV = "postgresql://owner:secret-dev@ep-other-name-456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"

    it("migrate の前に、secret を env で受け取って確かめる（式を run に埋め込まない）", () => {
      const index = job.steps.findIndex((s) => s.name === "Check DEVELOP_DATABASE_URL is not production")
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(job.steps.findIndex((s) => s.run?.includes("db:migrate")))
      expect(step()?.env).toEqual({
        DEVELOP_URL: "${{ secrets.DEVELOP_DATABASE_URL }}",
        PRODUCTION_URL: "${{ secrets.NEON_DATABASE_URL }}",
      })
      expect(step()?.run ?? "").not.toContain("${{")
    })

    it("別の DB（Neon の別ブランチ）なら通る", () => {
      expect(exec(DEV, PROD).status).toBe(0)
    })

    it.each([
      ["同じ値", PROD],
      ["認証情報だけ違う", PROD.replace("secret-prod", "another-password")],
      ["クエリ文字列だけ違う", PROD.replace("?sslmode=require", "?sslmode=require&channel_binding=require")],
      ["接続プール（-pooler）の host", PROD.replace("ep-cool-name-123.", "ep-cool-name-123-pooler.")],
      ["大文字小文字とポートだけ違う", PROD.replace("ep-cool-name-123.ap-southeast-1.aws.neon.tech", "EP-COOL-NAME-123.ap-southeast-1.aws.neon.tech:5432")],
    ])("本番と同じ DB（%s）なら、値を出さずに ::error で止まる", (_label, develop) => {
      const result = exec(develop, PROD)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain("::error title=DEVELOP_DATABASE_URL points to production::")
      // 接続文字列（ホスト名やパスワード）をログに出さない
      for (const secret of ["secret-prod", "another-password", "ep-cool-name", "EP-COOL-NAME", "neondb"]) {
        expect(result.stdout + result.stderr).not.toContain(secret)
      }
    })

    it("クエリの値に @ が入っていても、host を取り違えない（本番を指していれば止まる）", () => {
      expect(exec(`${PROD}&options=@ep-other-name-456.ap-southeast-1.aws.neon.tech/neondb`, PROD).status).toBe(1)
    })

    it("クエリの値に @ と本番の host が入っていても、別の DB なら通る", () => {
      expect(exec(`${DEV}&options=@ep-cool-name-123.ap-southeast-1.aws.neon.tech/neondb`, PROD).status).toBe(0)
    })

    it.each([["末尾の改行", `${PROD.replace("?sslmode=require", "")}\n`], ["前後の空白", `  ${PROD.replace("?sslmode=require", "")}  `]])(
      "secret に紛れた空白（%s）は無視する（本番を指していれば止まる）",
      (_label, develop) => {
        expect(exec(develop, PROD).status).toBe(1)
      }
    )

    it("DB 名の末尾の / は無視する（本番を指していれば止まる）", () => {
      expect(exec(PROD.replace("/neondb?", "/neondb/?"), PROD).status).toBe(1)
    })

    it("同じ host でも DB 名が違えば通る", () => {
      expect(exec(PROD.replace("/neondb?", "/develop?"), PROD).status).toBe(0)
    })

    it("本番の secret が読めないときは、警告を出して先に進む（migrate 自体は止めない）", () => {
      const result = exec(DEV, "")
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("::warning title=NEON_DATABASE_URL is not set::")
    })
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

describe("CI の起動条件", () => {
  it.each([["push"], ["pull_request"]] as const)(
    "%s は paths で絞らない（docs だけの PR にもブランチ保護の必須チェックが付くように）",
    (event) => {
      const trigger = workflow.on[event]
      expect(trigger?.branches).toEqual(["main", "develop"])
      expect(trigger?.paths).toBeUndefined()
      expect(trigger?.["paths-ignore"]).toBeUndefined()
    },
  )

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

describe("本番 DB への手動 migrate（migrate-production.yml）(#164)", () => {
  type ManualWorkflow = {
    on: Record<string, { inputs?: Record<string, { required?: boolean; type?: string }> } | null>
    permissions?: Record<string, string>
    jobs: Record<string, Job>
  }
  const manual = parse(
    readFileSync(path.resolve(__dirname, "../../.github/workflows/migrate-production.yml"), "utf-8")
  ) as ManualWorkflow
  const check = manual.jobs.check
  const migrate = manual.jobs.migrate
  const stepNamed = (job: Job, name: string) => job.steps.find((s) => s.name === name)
  /** shell を指定しない step の既定（bash -e {0}）と同じく、bash -e で run を実行する */
  const runBash = (run: string, env: Record<string, string>, cwd?: string) =>
    spawnSync("bash", ["-e", "-c", run], { env: { ...process.env, ...env }, cwd, encoding: "utf-8" })

  it("手動実行（workflow_dispatch）だけで動き、確認の入力が必須", () => {
    expect(Object.keys(manual.on)).toEqual(["workflow_dispatch"])
    const confirm = manual.on.workflow_dispatch?.inputs?.confirm
    expect(confirm?.required).toBe(true)
    expect(confirm?.type).toBe("string")
  })

  it("GITHUB_TOKEN の権限を contents: read に絞る", () => {
    expect(manual.permissions).toEqual({ contents: "read" })
  })

  it("確認の job は production 環境と secret を使わず、migrate は確認が通ってから production 環境で動く", () => {
    expect(check.environment).toBeUndefined()
    expect(JSON.stringify(check)).not.toContain("secrets.")
    expect([migrate.needs ?? []].flat()).toEqual(["check"])
    expect(migrate.environment).toBe("production")
  })

  it("ci.yml の本番 migrate と同じ concurrency group で、本番 DB への migrate を 1 本ずつにする（実行中は取り消さない）", () => {
    expect(migrate.concurrency?.group).toBe(workflow.jobs.migrate.concurrency?.group)
    expect(migrate.concurrency?.group).toBe("migrate-production")
    expect(migrate.concurrency?.["cancel-in-progress"]).toBe(false)
  })

  it("ci.yml と同じく、本番の secret で毎回 db:migrate を実行する（適用済みの分は飛ばされる）", () => {
    const step = migrate.steps.find((s) => s.run?.includes("db:migrate"))
    expect(step?.env?.DATABASE_URL).toBe("${{ secrets.NEON_DATABASE_URL }}")
    expect(step?.if).toBeUndefined()
  })

  it("main への push で動く ci.yml の本番 migrate は残っている", () => {
    expect(workflow.jobs.migrate.if).toBe("github.ref == 'refs/heads/main'")
    expect(workflow.jobs.migrate.steps.some((s) => s.run?.includes("db:migrate"))).toBe(true)
  })

  it("checkout は認証情報を残さない（後の step で git の資格情報を使わない）", () => {
    for (const job of [check, migrate]) {
      const checkout = job.steps.find((s) => s.uses?.startsWith("actions/checkout")) as (Step & { with?: Record<string, unknown> }) | undefined
      expect(checkout?.with?.["persist-credentials"]).toBe(false)
    }
  })

  it("式を run に直接埋め込まない（入力や secret は env で受け取る）", () => {
    for (const job of [check, migrate]) {
      for (const s of job.steps) expect(s.run ?? "").not.toContain("${{")
    }
  })

  describe("ref と確認の入力のチェック", () => {
    const exec = (ref: string, confirm: string) =>
      runBash(stepNamed(check, "Check ref and confirmation")?.run ?? "", { REF: ref, CONFIRM: confirm })

    it("env で ref と入力を受け取る", () => {
      expect(stepNamed(check, "Check ref and confirmation")?.env).toEqual({
        REF: "${{ github.ref }}",
        CONFIRM: "${{ inputs.confirm }}",
      })
    })

    it.each([["refs/heads/develop"], ["refs/heads/main"]])("%s で \"migrate production\" と入力すれば通る", (ref) => {
      expect(exec(ref, "migrate production").status).toBe(0)
    })

    it.each([["refs/heads/feature/x"], ["refs/tags/v1"], ["refs/heads/develop2"]])(
      "develop・main 以外の ref（%s）では止まる",
      (ref) => {
        const result = exec(ref, "migrate production")
        expect(result.status).toBe(1)
        expect(result.stdout).toContain("::error title=Unsupported ref::")
      }
    )

    it.each([[""], ["migrate"], ["Migrate Production"], ["migrate production "]])(
      "入力が \"migrate production\" と一致しない（%j）と止まる",
      (confirm) => {
        const result = exec("refs/heads/develop", confirm)
        expect(result.status).toBe(1)
        expect(result.stdout).toContain("::error title=Confirmation mismatch::")
      }
    )
  })

  describe("expand のマイグレーションだけかのチェック", () => {
    const step = () => stepNamed(check, "Check migrations are expand-only")
    const dir = "src/infrastructure/db/drizzle/migrations"
    const gitEnv = {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    }

    /** main に base のファイルを置き、develop で changes を足した（null は削除）一時リポジトリでチェックを流す */
    function execWith(base: Record<string, string>, changes: Record<string, string | null>) {
      const repo = mkdtempSync(path.join(tmpdir(), "migrate-check-"))
      const git = (...args: string[]) => {
        const r = spawnSync("git", args, { cwd: repo, env: { ...process.env, ...gitEnv }, encoding: "utf-8" })
        expect(r.status, r.stderr).toBe(0)
      }
      const write = (files: Record<string, string | null>) => {
        for (const [name, content] of Object.entries(files)) {
          const file = path.join(repo, dir, name)
          if (content === null) rmSync(file)
          else writeFileSync(file, content)
        }
      }
      try {
        git("init", "-q", "-b", "main")
        mkdirSync(path.join(repo, dir), { recursive: true })
        write({ "0000_init.sql": 'CREATE TABLE "items" ("id" text);', ...base })
        git("add", "-A")
        git("commit", "-q", "-m", "base")
        git("checkout", "-q", "-b", "develop")
        write(changes)
        git("add", "-A")
        git("commit", "-q", "--allow-empty", "-m", "change")
        return runBash(step()?.run ?? "", { ...gitEnv, BASE_REF: "main" }, repo)
      } finally {
        rmSync(repo, { recursive: true, force: true })
      }
    }

    it("main との差分を取るため、全履歴を取得してから、origin/main と比べる", () => {
      const checkout = check.steps.find((s) => s.uses?.startsWith("actions/checkout"))
      expect((checkout as Step & { with?: Record<string, unknown> })?.with?.["fetch-depth"]).toBe(0)
      expect(step()?.env?.BASE_REF).toBe("origin/main")
      expect(check.steps.indexOf(checkout!)).toBeLessThan(check.steps.indexOf(step()!))
    })

    it("main にない migration がなければ、notice を出して通る", () => {
      const result = execWith({}, {})
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain("::notice title=No new migrations::")
    })

    it("O3 の migration（列・インデックスの追加と、埋めてからの SET NOT NULL）は通る", () => {
      const o3 = readFileSync(path.resolve(__dirname, `../../${dir}/0005_sync_columns.sql`), "utf-8")
      const result = execWith({}, { "0005_sync_columns.sql": o3 })
      expect(result.status, result.stdout + result.stderr).toBe(0)
      expect(result.stdout).toContain("0005_sync_columns.sql")
    })

    it.each([
      ["列の削除", 'ALTER TABLE "items" DROP COLUMN "memo";'],
      ["テーブルの削除", 'DROP TABLE "purchase_history" CASCADE;'],
      ["小文字の drop table", 'drop table if exists "purchase_history";'],
      ["列の名前の変更", 'ALTER TABLE "items" RENAME COLUMN "memo" TO "note";'],
      ["テーブルの名前の変更", 'ALTER TABLE "items" RENAME TO "products";'],
      ["drizzle の型の変更", 'ALTER TABLE "items" ALTER COLUMN "quantity" SET DATA TYPE integer;'],
      ["型の変更（TYPE）", 'ALTER TABLE "items" ALTER COLUMN "quantity" TYPE integer;'],
    ])("contract の変更（%s）があれば ::error で止まる", (_label, sql) => {
      const result = execWith({}, { "0006_contract.sql": `ALTER TABLE "items" ADD COLUMN "x" text;--> statement-breakpoint\n${sql}` })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain(`::error file=${dir}/0006_contract.sql,title=Not an expand migration::`)
    })

    it("複数の migration のうち 1 つでも contract があれば止まる", () => {
      const result = execWith({}, {
        "0006_a.sql": 'ALTER TABLE "items" ADD COLUMN "x" text;',
        "0007_b.sql": 'ALTER TABLE "items" DROP COLUMN "y";',
      })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain("0007_b.sql,title=Not an expand migration")
      expect(result.stdout).not.toContain("0006_a.sql,title=")
    })

    it("コメントの中の DROP や、名前に rename を含む列は止めない", () => {
      const result = execWith({}, {
        "0006_expand.sql": [
          '-- 古い列は DROP COLUMN せず残す（contract は後のリリースで）',
          '  -- DROP TABLE "x" はしない',
          'ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "renamed_at" timestamp;',
          'ALTER TABLE "items" ALTER COLUMN "memo" DROP NOT NULL;',
          'ALTER TABLE "items" ALTER COLUMN "memo" DROP DEFAULT;',
        ].join("\n"),
      })
      expect(result.status, result.stdout).toBe(0)
    })

    it("main に既にある migration（適用済み）の DROP は対象にしない", () => {
      const result = execWith({ "0002_drop.sql": 'DROP TABLE "purchase_history" CASCADE;' }, { "0003_add.sql": 'ALTER TABLE "items" ADD COLUMN "x" text;' })
      expect(result.status, result.stdout).toBe(0)
    })

    it("develop で消した migration は対象にしない", () => {
      const result = execWith({ "0002_drop.sql": 'DROP TABLE "purchase_history" CASCADE;' }, { "0002_drop.sql": null })
      expect(result.status, result.stdout).toBe(0)
    })
  })

  describe("secret のチェック", () => {
    const run = () => stepNamed(migrate, "Check NEON_DATABASE_URL")?.run ?? ""

    it("migrate の前に、secret が空なら明確なメッセージで止まり、設定されていれば通る", () => {
      const index = migrate.steps.findIndex((s) => s.name === "Check NEON_DATABASE_URL")
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(migrate.steps.findIndex((s) => s.run?.includes("db:migrate")))
      const missing = runBash(run(), { DATABASE_URL: "" })
      expect(missing.status).toBe(1)
      expect(missing.stdout).toContain("::error title=NEON_DATABASE_URL is not set::")
      expect(runBash(run(), { DATABASE_URL: "postgresql://u:p@host/db" }).status).toBe(0)
    })
  })

  it("設計書とチームのルールに、main への PR をマージする前に流す手順が書かれている", () => {
    for (const doc of ["../../docs/features/offline-support.md", "../../.claude/rules/team-operation.md"]) {
      const text = readFileSync(path.resolve(__dirname, doc), "utf-8")
      expect(text).toContain("gh workflow run migrate-production.yml --ref develop")
    }
  })
})
