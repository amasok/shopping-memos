#!/usr/bin/env bash
# CI と同じ E2E（chromium・chromium-auth・Mobile Chrome・offline）を、ローカルで全部流す（#142）。
#
#   npm run test:e2e:local
#   npm run test:e2e:local -- e2e/ogp-preview.spec.ts   # 引数は playwright test にそのまま渡す（offline は流さない）
#
# - DB: docker compose の postgres（127.0.0.1:5432）に、worktree（ブランチ）ごとの E2E 用 DB を作り直して db:migrate する。
#   DATABASE_URL などはこのスクリプトの環境変数で渡し、.env は読まない・書かない
# - ポート: 空いているポートを選んで E2E_PORT / E2E_OFFLINE_PORT に渡す。既存のサーバーは使い回さない
#   （worktree を並行して使っても、ほかの worktree のサーバーに当たらない）
# - ビルド: CI と同じく E2E_BUILD=true の本番ビルド（.next は worktree ごと）を next start で動かす
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

PG_CONTAINER="${E2E_PG_CONTAINER:-shopping-memos-db}"
PG_HOST_PORT=5432

log() { printf '\n== %s ==\n' "$*"; }
fail() {
  printf '\n[e2e-local] %s\n' "$*" >&2
  exit 1
}

# --- Docker ---------------------------------------------------------------
ensure_docker() {
  command -v docker >/dev/null 2>&1 || fail "docker コマンドが見つかりません。Docker Desktop をインストールしてください。"
  if docker info >/dev/null 2>&1; then return; fi

  if [[ "$(uname)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
    echo "[e2e-local] Docker が起動していないので、Docker Desktop を起動します（open -a Docker）..."
    open -a Docker >/dev/null 2>&1 || true
    for _ in $(seq 1 60); do
      if docker info >/dev/null 2>&1; then return; fi
      sleep 2
    done
  fi
  fail "Docker が起動していません。Docker Desktop を起動してから、もう一度実行してください。"
}

# docker compose の postgres を起動する。メインの作業フォルダと同じ compose プロジェクト（shopping-memos）にして、
# worktree から実行しても同じコンテナ（container_name: shopping-memos-db）を使う
ensure_postgres() {
  if [[ "$(docker inspect -f '{{.State.Running}}' "${PG_CONTAINER}" 2>/dev/null || true)" != "true" ]]; then
    echo "[e2e-local] postgres を起動します（docker compose up -d postgres）..."
    docker compose -p shopping-memos -f "${ROOT}/docker-compose.yml" up -d postgres >/dev/null
  fi
  for _ in $(seq 1 30); do
    if docker exec "${PG_CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then return; fi
    sleep 1
  done
  fail "postgres（${PG_CONTAINER}）が応答しません。docker compose logs postgres を確認してください。"
}

# worktree のパスの短いハッシュ（DB 名とロックに使う）
worktree_hash() {
  printf '%s' "${ROOT}" | shasum | cut -c1-8
}

# 実行ごとに別の DB 名を作る: sm_e2e_<ブランチ>_<worktree のハッシュ>_<時刻>_<PID>
# （英小文字・数字・_ だけ、63 文字まで）。同じブランチでも、別の worktree や別の実行とはぶつからない
e2e_db_name() {
  local branch safe run_id
  # detached（worktree をコミットで切ったとき）はコミットの短いハッシュ
  branch="$(git -C "${ROOT}" symbolic-ref --short -q HEAD 2>/dev/null || git -C "${ROOT}" rev-parse --short HEAD 2>/dev/null || echo local)"
  safe="$(printf '%s' "$branch" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_' | sed -E 's/_+/_/g; s/^_//; s/_$//' | cut -c1-24)"
  run_id="$(date +%s)_$$"
  printf 'sm_e2e_%s_%s_%s' "${safe:-local}" "$(worktree_hash)" "${run_id}" | cut -c1-63
}

# 空の DB を作る（CI と同じく空の DB から始める）。名前は実行ごとに別なので、ほかの実行の DB は消さない
create_db() {
  docker exec "${PG_CONTAINER}" psql -U postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$1\"" >/dev/null
}

drop_db() {
  docker exec "${PG_CONTAINER}" psql -U postgres -q -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)" >/dev/null 2>&1 || true
}

# 同じ worktree での同時実行を止める（.next・e2e/.auth・test-results を共有するため）。
# ロックは worktree の外（TMPDIR）のシンボリックリンクで、リンク先が持ち主の PID。ln -s は作成と PID の記録が
# 1 回で済む（mkdir してから PID を書く方式の「PID がまだ無い」すき間がない）。持ち主が終わっていれば取り直す
LOCK_PATH=""
acquire_lock() {
  local lock owner stale _
  lock="${TMPDIR:-/tmp}/shopping-memos-e2e-local-$(worktree_hash).lock"
  for _ in 1 2 3 4 5; do
    if ln -s "$$" "${lock}" 2>/dev/null; then
      LOCK_PATH="${lock}"
      return 0
    fi
    owner="$(readlink "${lock}" 2>/dev/null || true)"
    # 読む前に消えた（持ち主が終わった直後）。もう一度取りに行く
    [[ -z "${owner}" ]] && continue
    if kill -0 "${owner}" 2>/dev/null; then
      fail "この worktree（${ROOT}）では、ほかの test:e2e:local（PID ${owner}）が実行中です。終わってから実行してください。"
    fi
    # 終わったプロセスのロック。rename は 1 本だけが成功するので、退かしてから中身を確かめる
    stale="${lock}.stale.$$"
    if mv "${lock}" "${stale}" 2>/dev/null; then
      if [[ "$(readlink "${stale}" 2>/dev/null || true)" != "${owner}" ]]; then
        # 先に取り直したほかの実行のロックを退かしてしまった。元に戻す（その間に作られていれば向こうが優先）
        ln -s "$(readlink "${stale}")" "${lock}" 2>/dev/null || true
      fi
      rm -f "${stale}"
    fi
  done
  fail "ロック（${lock}）を取れません。しばらくしてから、もう一度実行してください。"
}

DB_NAME=""
cleanup() {
  [[ -n "${DB_NAME}" ]] && drop_db "${DB_NAME}"
  # 自分のロックだけを消す
  if [[ -n "${LOCK_PATH}" && "$(readlink "${LOCK_PATH}" 2>/dev/null || true)" == "$$" ]]; then
    rm -f "${LOCK_PATH}"
  fi
  return 0
}

# --- ポート -----------------------------------------------------------------
# 空いているポートを 2 つ選ぶ（OS に 0 番で割り当てさせる）
pick_ports() {
  node -e '
    const net = require("net")
    const pick = () => new Promise((resolve, reject) => {
      const s = net.createServer()
      s.unref()
      s.on("error", reject)
      s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)) })
    })
    Promise.all([pick(), pick()]).then(([a, b]) => console.log(a, b))
  '
}

# --- 実行 -----------------------------------------------------------------
main() {
  trap cleanup EXIT
  trap 'exit 130' INT TERM

  acquire_lock
  ensure_docker
  ensure_postgres

  DB_NAME="$(e2e_db_name)"
  log "DB を作る: ${DB_NAME}（終わったら消す）"
  create_db "${DB_NAME}"

  read -r PORT OFFLINE_PORT <<<"$(pick_ports)"

  # .env は読まない（Next.js は .env を読むが、ここで渡す環境変数が優先される）。worktree に .env があれば知らせる
  for f in .env .env.local; do
    [[ -e "${ROOT}/${f}" ]] && echo "[e2e-local] 注意: ${f} があります。ここで渡す変数（DATABASE_URL・AUTH_SECRET など）が優先されますが、それ以外の値は Next.js に読まれます。"
  done

  export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PG_HOST_PORT}/${DB_NAME}"
  export AUTH_SECRET="e2e-local-$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
  export AUTH_TRUST_HOST=true
  export E2E_SEED_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  export E2E_PORT="$PORT"
  export E2E_OFFLINE_PORT="$OFFLINE_PORT"
  export E2E_START=true
  export E2E_REUSE_SERVER=false

  log "db:migrate"
  npm run db:migrate

  log "本番ビルド（E2E_BUILD=true）"
  E2E_BUILD=true npm run build

  log "ゲストモード E2E（ポート ${E2E_PORT}）"
  if [[ $# -gt 0 ]]; then
    npx playwright test "$@"
    return 0
  fi
  # ゲストモード（IndexedDB だけ）は並列で流す
  npx playwright test --project=chromium --project="Mobile Chrome"

  # ログイン済み（e2e/auth）は、ファイルをまたいで同じユーザー A / B と同じ DB を使うため、並列だとほかのテストの
  # merge や件数に干渉されて落ちることがある（merge-foreign-id など）。CI と同じく 1 ワーカーで流す
  log "ログイン済み E2E（1 ワーカー）"
  npx playwright test --project=chromium-auth --workers=1

  log "offline E2E（ポート ${E2E_OFFLINE_PORT}）"
  E2E_OFFLINE=true npx playwright test --project=offline

  log "OK（DB: ${DB_NAME}、ポート: ${E2E_PORT} / ${E2E_OFFLINE_PORT}）"
}

# テストから関数だけを読み込めるよう、直接実行されたときだけ main を動かす
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
