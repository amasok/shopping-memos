#!/usr/bin/env bash
# 実 DB が必要なテスト（src/**/*.db.test.ts。#151）を流す。
#
#   npm run test:db
#
# docker compose の postgres（shopping-memos-db）に一時 DB を作り、db:migrate して、テストを流し、終わったら消す。
# .env は読まない。DATABASE_URL などはこのスクリプトの環境変数で渡す
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
PG_CONTAINER="${E2E_PG_CONTAINER:-shopping-memos-db}"
DB_NAME="sm_dbtest_$(date +%s)_$$"

docker exec "${PG_CONTAINER}" pg_isready -U postgres >/dev/null 2>&1 || {
  echo "[test-db] postgres（${PG_CONTAINER}）が動いていません。docker compose up -d postgres を実行してください。" >&2
  exit 1
}

cleanup() {
  docker exec "${PG_CONTAINER}" psql -U postgres -q -c "DROP DATABASE IF EXISTS \"${DB_NAME}\" WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker exec "${PG_CONTAINER}" psql -U postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"${DB_NAME}\"" >/dev/null

export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/${DB_NAME}"
export OWNERSHIP_DB_TEST_URL="${DATABASE_URL}"
# マイグレーションのテスト（#62 O3）は、このサーバーに専用の DB を作って消す
export DB_TEST_URL="${DATABASE_URL}"
npm run db:migrate
# SQL ログ（開発用の logger）が多いので --silent で出さない
npx vitest run --silent --testTimeout=30000 .db.test.ts "$@"
