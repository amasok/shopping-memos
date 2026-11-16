// @vitest-environment node
import { spawn, spawnSync } from "child_process"
import { existsSync, mkdtempSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

/**
 * scripts/e2e-local.sh の、DB 名と同時実行のロック（#142）。
 * スクリプトを source して関数だけを呼ぶ（直接実行したときだけ main が動く）
 */
const SCRIPT = path.resolve(__dirname, "../../scripts/e2e-local.sh")

function bash(body: string, env: Record<string, string> = {}) {
  return spawnSync("bash", ["-c", `source "${SCRIPT}"\n${body}`], {
    env: { ...process.env, ...env },
    encoding: "utf-8",
  })
}

function gitRepo(branch: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-local-repo-"))
  spawnSync("git", ["init", "-q", "-b", branch, dir])
  return dir
}

const children: { kill: () => void }[] = []
afterEach(() => {
  for (const child of children.splice(0)) child.kill()
})

describe("e2e-local.sh の DB 名 (#142)", () => {
  const dbName = (root: string) => {
    const result = bash(`ROOT="${root}"; e2e_db_name`)
    expect(result.status, result.stderr).toBe(0)
    return result.stdout.trim()
  }

  it("実行ごとに別の名前になる（同じ worktree・同じブランチでも、別の実行の DB を消さない）", () => {
    const root = gitRepo("feature/x")
    expect(dbName(root)).not.toBe(dbName(root))
  })

  it("ブランチ名と worktree のパスのハッシュを含み、PostgreSQL の識別子として安全な文字だけ", () => {
    const root = gitRepo("Feature/Issue-142.Local")
    const hash = bash(`ROOT="${root}"; worktree_hash`).stdout.trim()
    const name = dbName(root)

    expect(hash).toMatch(/^[0-9a-f]{8}$/)
    expect(name).toMatch(new RegExp(`^sm_e2e_feature_issue_142_local_${hash}_\\d+_\\d+$`))
  })

  it("detached の worktree では、コミットの短いハッシュを使う", () => {
    const root = gitRepo("main")
    spawnSync("git", ["-C", root, "-c", "user.email=e2e@example.invalid", "-c", "user.name=e2e", "commit", "-q", "--allow-empty", "-m", "x"])
    spawnSync("git", ["-C", root, "checkout", "-q", "--detach"])
    const sha = spawnSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf-8" }).stdout.trim()

    expect(dbName(root)).toMatch(new RegExp(`^sm_e2e_${sha}_[0-9a-f]{8}_\\d+_\\d+$`))
  })

  it("同じブランチ名でも、worktree が違えばハッシュが違う", () => {
    const a = bash(`ROOT="${gitRepo("same")}"; worktree_hash`).stdout.trim()
    const b = bash(`ROOT="${gitRepo("same")}"; worktree_hash`).stdout.trim()
    expect(a).not.toBe(b)
  })

  it("長いブランチ名でも 63 文字（PostgreSQL の上限）に収まり、実行ごとの ID は残る", () => {
    const root = gitRepo(`feature/${"very-long-branch-name-".repeat(5)}`)
    const name = dbName(root)
    expect(name.length).toBeLessThanOrEqual(63)
    expect(name).toMatch(/_\d+_\d+$/)
  })
})

describe("e2e-local.sh の同時実行のロック (#142)", () => {
  it("同じ worktree で実行中なら、2 つ目は分かりやすいメッセージで止まり、終わったプロセスのロックは取り直す", async () => {
    const root = gitRepo("lock-test")
    const env = { TMPDIR: mkdtempSync(path.join(tmpdir(), "e2e-local-lock-")) }

    // 1 つ目: ロックを取って待つ
    const first = spawn("bash", ["-c", `source "${SCRIPT}"\nROOT="${root}"; acquire_lock; echo locked; sleep 30`], {
      env: { ...process.env, ...env },
    })
    children.push(first)
    await new Promise<void>((resolve) => first.stdout.on("data", (d) => String(d).includes("locked") && resolve()))

    const second = bash(`ROOT="${root}"; acquire_lock`, env)
    expect(second.status).toBe(1)
    expect(second.stderr).toContain("ほかの test:e2e:local")
    expect(second.stderr).toContain(`PID ${first.pid}`)

    // 別の worktree はロックが別なので、同時に実行できる
    expect(bash(`ROOT="${gitRepo("other")}"; acquire_lock`, env).status).toBe(0)

    // 1 つ目が（後始末をせずに）終わったら、残ったロックを取り直せる
    first.kill("SIGKILL")
    await new Promise((resolve) => first.on("exit", resolve))
    expect(bash(`ROOT="${root}"; acquire_lock`, env).status).toBe(0)
  })

  it("cleanup でロックを消す", () => {
    const root = gitRepo("cleanup-test")
    const tmp = mkdtempSync(path.join(tmpdir(), "e2e-local-lock-"))
    const result = bash(`ROOT="${root}"; acquire_lock; echo "$LOCK_DIR"; cleanup`, { TMPDIR: tmp })

    expect(result.status, result.stderr).toBe(0)
    const lockDir = result.stdout.trim()
    expect(lockDir.startsWith(tmp)).toBe(true)
    expect(existsSync(lockDir)).toBe(false)
  })
})
