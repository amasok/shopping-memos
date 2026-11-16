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

cd "$(dirname "$0")/.."
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

# ブランチ名から DB 名を作る（英小文字・数字・_ だけ、63 文字まで）
e2e_db_name() {
  local branch
  branch="$(git -C "${ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo local)"
  local safe
  safe="$(printf '%s' "$branch" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_' | sed -E 's/_+/_/g; s/^_//; s/_$//')"
  printf 'shopping_memos_e2e_%s' "${safe:-local}" | cut -c1-63
}

recreate_db() {
  local db="$1"
  # 前回の実行のデータが残らないよう、毎回作り直す（CI と同じく空の DB から始める）
  docker exec "${PG_CONTAINER}" psql -U postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE)" \
    -c "CREATE DATABASE \"${db}\"" >/dev/null
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
ensure_docker
ensure_postgres

DB_NAME="$(e2e_db_name)"
log "DB を作り直す: ${DB_NAME}"
recreate_db "${DB_NAME}"

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

log "E2E（ポート ${E2E_PORT}）"
if [[ $# -gt 0 ]]; then
  npx playwright test "$@"
  exit 0
fi
npx playwright test --project=chromium --project=chromium-auth --project="Mobile Chrome"

log "offline E2E（ポート ${E2E_OFFLINE_PORT}）"
E2E_OFFLINE=true npx playwright test --project=offline

log "OK（DB: ${DB_NAME}、ポート: ${E2E_PORT} / ${E2E_OFFLINE_PORT}）"
